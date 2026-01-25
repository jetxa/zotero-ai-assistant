/**
 * Streaming Markdown Renderer
 *
 * Features:
 * - Renders markdown elements to HTML
 * - Preserves formulas (LaTeX) as raw text
 * - Supports streaming updates
 * - Falls back to raw text for incomplete elements
 */

// Formula patterns to protect from rendering
const FORMULA_PATTERNS = [
  /\$\$[\s\S]*?\$\$/g, // Block: $$...$$
  /\$[^$\n]+\$/g, // Inline: $...$
  /\\\[[\s\S]*?\\\]/g, // Block: \[...\]
  /\\\([\s\S]*?\\\)/g, // Inline: \(...\)
];

// Placeholder to protect formulas during parsing
const FORMULA_PLACEHOLDER = "\u0000FORMULA_";

interface MarkdownState {
  inCodeBlock: boolean;
  codeBlockLang: string;
  codeBlockContent: string[];
  pendingListType: "ul" | "ol" | null;
  listItems: string[];
  inTable: boolean;
  tableRows: string[][];
  tableAlignments: ("left" | "center" | "right" | null)[];
}

/**
 * Protect formulas by replacing them with placeholders
 */
function protectFormulas(text: string): {
  text: string;
  formulas: Map<string, string>;
} {
  const formulas = new Map<string, string>();
  let index = 0;
  let result = text;

  for (const pattern of FORMULA_PATTERNS) {
    result = result.replace(pattern, (match) => {
      const placeholder = `${FORMULA_PLACEHOLDER}${index++}\u0000`;
      formulas.set(placeholder, match);
      return placeholder;
    });
  }

  return { text: result, formulas };
}

/**
 * Restore formulas from placeholders
 */
function restoreFormulas(text: string, formulas: Map<string, string>): string {
  let result = text;
  for (const [placeholder, formula] of formulas) {
    result = result.replace(placeholder, escapeHtml(formula));
  }
  return result;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Parse inline markdown elements
 */
function parseInlineMarkdown(text: string): string {
  let result = escapeHtml(text);

  // Bold: **text** or __text__
  result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/__([^_]+)__/g, "<strong>$1</strong>");

  // Italic: *text* or _text_ (but not inside words for underscore)
  result = result.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  result = result.replace(
    /(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g,
    "<em>$1</em>",
  );

  // Strikethrough: ~~text~~
  result = result.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  // Inline code: `code`
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Links: [text](url)
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );

  // Images: ![alt](url)
  result = result.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" style="max-width: 100%;" />',
  );

  return result;
}

/**
 * Check if inline markdown is complete (no unclosed markers)
 */
function isInlineComplete(text: string): boolean {
  // Check for unclosed bold/italic markers
  const boldCount = (text.match(/\*\*/g) || []).length;
  if (boldCount % 2 !== 0) return false;

  const italicCount = (text.match(/(?<!\*)\*(?!\*)/g) || []).length;
  if (italicCount % 2 !== 0) return false;

  const strikeCount = (text.match(/~~/g) || []).length;
  if (strikeCount % 2 !== 0) return false;

  const codeCount = (text.match(/`/g) || []).length;
  if (codeCount % 2 !== 0) return false;

  // Check for unclosed links
  const openBracket = (text.match(/\[/g) || []).length;
  const closedLink = (text.match(/\]\([^)]*\)/g) || []).length;
  if (openBracket > closedLink) return false;

  return true;
}

/**
 * Parse a single line of markdown
 */
function parseLine(
  line: string,
  state: MarkdownState,
): { html: string; state: MarkdownState } {
  const newState = { ...state };

  // Handle code block start/end
  if (line.startsWith("```")) {
    if (!state.inCodeBlock) {
      newState.inCodeBlock = true;
      newState.codeBlockLang = line.slice(3).trim();
      newState.codeBlockContent = [];
      return { html: "", state: newState };
    } else {
      newState.inCodeBlock = false;
      const codeContent = newState.codeBlockContent.join("\n");
      newState.codeBlockContent = [];
      const langClass = newState.codeBlockLang
        ? ` class="language-${newState.codeBlockLang}"`
        : "";
      return {
        html: `<pre><code${langClass}>${escapeHtml(codeContent)}</code></pre>`,
        state: newState,
      };
    }
  }

  // Inside code block - just accumulate
  if (state.inCodeBlock) {
    newState.codeBlockContent = [...state.codeBlockContent, line];
    return { html: "", state: newState };
  }

  // Empty line - close any pending list
  if (line.trim() === "") {
    if (state.pendingListType) {
      const listHtml = `<${state.pendingListType}>${state.listItems.map((i) => `<li>${i}</li>`).join("")}</${state.pendingListType}>`;
      newState.pendingListType = null;
      newState.listItems = [];
      return { html: listHtml + "<br/>", state: newState };
    }
    return { html: "<br/>", state: newState };
  }

  // Headers: # ## ### etc
  const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
  if (headerMatch) {
    const level = headerMatch[1].length;
    const content = parseInlineMarkdown(headerMatch[2]);
    return { html: `<h${level}>${content}</h${level}>`, state: newState };
  }

  // Horizontal rule: --- or *** or ___
  if (/^[-*_]{3,}$/.test(line.trim())) {
    return { html: "<hr/>", state: newState };
  }

  // Blockquote: > text
  const blockquoteMatch = line.match(/^>\s*(.*)$/);
  if (blockquoteMatch) {
    const content = parseInlineMarkdown(blockquoteMatch[1]);
    return {
      html: `<blockquote style="border-left: 3px solid #ccc; padding-left: 10px; margin: 5px 0; color: #666;">${content}</blockquote>`,
      state: newState,
    };
  }

  // Unordered list: - or * or + (with optional leading whitespace for nesting)
  const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
  if (ulMatch) {
    const indent = ulMatch[1].length;
    const content = parseInlineMarkdown(ulMatch[2]);
    const styledContent =
      indent > 0
        ? `<span style="margin-left: ${indent * 10}px; display: block;">${content}</span>`
        : content;
    if (state.pendingListType === "ul") {
      newState.listItems = [...state.listItems, styledContent];
      return { html: "", state: newState };
    } else {
      // Close previous list if different type
      let prefix = "";
      if (state.pendingListType === "ol") {
        prefix = `<ol>${state.listItems.map((i) => `<li>${i}</li>`).join("")}</ol>`;
      }
      newState.pendingListType = "ul";
      newState.listItems = [styledContent];
      return { html: prefix, state: newState };
    }
  }

  // Ordered list: 1. 2. etc (with optional leading whitespace for nesting)
  const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
  if (olMatch) {
    const olIndent = olMatch[1].length;
    const olContent = parseInlineMarkdown(olMatch[2]);
    const styledOlContent =
      olIndent > 0
        ? `<span style="margin-left: ${olIndent * 10}px; display: block;">${olContent}</span>`
        : olContent;
    if (state.pendingListType === "ol") {
      newState.listItems = [...state.listItems, styledOlContent];
      return { html: "", state: newState };
    } else {
      // Close previous list if different type
      let prefix = "";
      if (state.pendingListType === "ul") {
        prefix = `<ul>${state.listItems.map((i) => `<li>${i}</li>`).join("")}</ul>`;
      }
      newState.pendingListType = "ol";
      newState.listItems = [styledOlContent];
      return { html: prefix, state: newState };
    }
  }

  // Close any pending list before regular paragraph
  let prefix = "";
  if (state.pendingListType) {
    prefix = `<${state.pendingListType}>${state.listItems.map((i) => `<li>${i}</li>`).join("")}</${state.pendingListType}>`;
    newState.pendingListType = null;
    newState.listItems = [];
  }

  // Check if inline is complete
  if (isInlineComplete(line)) {
    const content = parseInlineMarkdown(line);
    return { html: prefix + `<p>${content}</p>`, state: newState };
  } else {
    // Incomplete inline - show raw
    return { html: prefix + `<p>${escapeHtml(line)}</p>`, state: newState };
  }
}

/**
 * Render markdown text to HTML
 * Supports streaming - call with accumulated text each time
 */
export function renderMarkdown(text: string): string {
  // Protect formulas first
  const { text: protectedText, formulas } = protectFormulas(text);

  const lines = protectedText.split("\n");
  let state: MarkdownState = {
    inCodeBlock: false,
    codeBlockLang: "",
    codeBlockContent: [],
    pendingListType: null,
    listItems: [],
    inTable: false,
    tableRows: [],
    tableAlignments: [],
  };

  const htmlParts: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isLastLine = i === lines.length - 1;

    // For streaming: if in code block and it's the last line without closing,
    // show accumulated code as raw text temporarily
    if (state.inCodeBlock && isLastLine && !line.startsWith("```")) {
      state.codeBlockContent.push(line);
      const rawCode =
        "```" + state.codeBlockLang + "\n" + state.codeBlockContent.join("\n");
      htmlParts.push(`<pre><code>${escapeHtml(rawCode)}</code></pre>`);
      continue;
    }

    // Table parsing
    const isTableRow = line.trim().startsWith("|") && line.trim().endsWith("|");
    const isSeparatorRow =
      /^\|?[\s:|-]+\|?$/.test(line.trim()) && line.includes("-");

    if (isTableRow || (state.inTable && isSeparatorRow)) {
      if (!state.inTable) {
        state.inTable = true;
        state.tableRows = [];
        state.tableAlignments = [];
      }

      if (isSeparatorRow && state.tableRows.length === 1) {
        // Parse alignment from separator row
        const cols = line.split("|").filter((c) => c.trim() !== "");
        state.tableAlignments = cols.map((col) => {
          const trimmed = col.trim();
          if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
          if (trimmed.endsWith(":")) return "right";
          if (trimmed.startsWith(":")) return "left";
          return null;
        });
      } else if (isTableRow) {
        const cells = line
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim());
        state.tableRows.push(cells);
      }

      // If this is the last line or next line is not a table row, render the table
      const nextLine = lines[i + 1];
      const nextIsTableRow =
        nextLine &&
        nextLine.trim().startsWith("|") &&
        nextLine.trim().endsWith("|");
      const nextIsSeparator =
        nextLine &&
        /^\|?[\s:|-]+\|?$/.test(nextLine.trim()) &&
        nextLine.includes("-");

      if (isLastLine || (!nextIsTableRow && !nextIsSeparator)) {
        // Render table
        if (state.tableRows.length > 0) {
          let tableHtml =
            '<div style="overflow-x: auto; max-width: 100%; margin: 0.5em 0;"><table style="border-collapse: collapse; min-width: 100%;">';

          state.tableRows.forEach((row, rowIndex) => {
            const isHeader = rowIndex === 0;
            const tag = isHeader ? "th" : "td";
            const bgColor = isHeader
              ? "#f0f0f0"
              : rowIndex % 2 === 0
                ? "#fafafa"
                : "transparent";

            tableHtml += "<tr>";
            row.forEach((cell, cellIndex) => {
              const align = state.tableAlignments[cellIndex] || "left";
              const cellStyle = `border: 1px solid #ddd; padding: 6px 10px; text-align: ${align}; background: ${bgColor};`;
              const content = parseInlineMarkdown(cell);
              tableHtml += `<${tag} style="${cellStyle}">${content}</${tag}>`;
            });
            tableHtml += "</tr>";
          });

          tableHtml += "</table></div>";
          htmlParts.push(tableHtml);
        }

        state.inTable = false;
        state.tableRows = [];
        state.tableAlignments = [];
      }
      continue;
    }

    // If we were in a table but this line isn't a table row, flush the table
    if (state.inTable) {
      if (state.tableRows.length > 0) {
        let tableHtml =
          '<div style="overflow-x: auto; max-width: 100%; margin: 0.5em 0;"><table style="border-collapse: collapse; min-width: 100%;">';

        state.tableRows.forEach((row, rowIndex) => {
          const isHeader = rowIndex === 0;
          const tag = isHeader ? "th" : "td";
          const bgColor = isHeader
            ? "#f0f0f0"
            : rowIndex % 2 === 0
              ? "#fafafa"
              : "transparent";

          tableHtml += "<tr>";
          row.forEach((cell, cellIndex) => {
            const align = state.tableAlignments[cellIndex] || "left";
            const cellStyle = `border: 1px solid #ddd; padding: 6px 10px; text-align: ${align}; background: ${bgColor};`;
            const content = parseInlineMarkdown(cell);
            tableHtml += `<${tag} style="${cellStyle}">${content}</${tag}>`;
          });
          tableHtml += "</tr>";
        });

        tableHtml += "</table></div>";
        htmlParts.push(tableHtml);
      }
      state.inTable = false;
      state.tableRows = [];
      state.tableAlignments = [];
    }

    const { html, state: newState } = parseLine(line, state);
    state = newState;
    if (html) {
      htmlParts.push(html);
    }
  }

  // Close any pending list at end
  if (state.pendingListType) {
    htmlParts.push(
      `<${state.pendingListType}>${state.listItems.map((i) => `<li>${i}</li>`).join("")}</${state.pendingListType}>`,
    );
  }

  // Restore formulas
  let result = htmlParts.join("");
  result = restoreFormulas(result, formulas);

  return result;
}

/**
 * Update a container element with rendered markdown
 * Designed for streaming updates
 */
export function updateMarkdownContainer(
  container: HTMLElement,
  text: string,
): void {
  const html = renderMarkdown(text);
  container.innerHTML = html;
}
