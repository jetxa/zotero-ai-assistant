import { getLocaleID, getString } from "../utils/locale";
import { updateMarkdownContainer } from "../utils/markdown";
import { getPref } from "../utils/prefs";

// --- Interfaces ---

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  tokenCount?: number;
  promptTokenCount?: number;
}

interface ChatSession {
  id: string;
  attachmentID?: number; // Link to Zotero Item ID
  createdAt: number;
  title: string;
  messages: ChatMessage[];
}

// --- Storage Manager (Attachment Based) ---
class StorageManager {
  static async getSessions(parentItem: Zotero.Item): Promise<ChatSession[]> {
    if (!parentItem.isRegularItem()) return [];

    const attachmentIDs = parentItem.getAttachments();
    const sessions: ChatSession[] = [];

    for (const id of attachmentIDs) {
      const attachment = Zotero.Items.get(id);
      const title = attachment.getField("title");
      if (title.startsWith("AI-Assistant-")) {
        try {
          // Check if file exists
          if (!(await attachment.fileExists())) continue;
          const path = attachment.getFilePath();
          if (!path) continue;
          const content = await Zotero.File.getContentsAsync(path);
          if (content) {
            const session = JSON.parse(content as string) as ChatSession;
            // Ensure ID link is preserved
            session.attachmentID = attachment.id;
            sessions.push(session);
          }
        } catch (e) {
          Zotero.debug(
            `[AI Assistant] Failed to load session from attachment ${id}: ${e}`,
          );
        }
      }
    }
    return sessions;
  }

  static async saveSession(
    parentItem: Zotero.Item,
    session: ChatSession,
  ): Promise<void> {
    try {
      const jsonString = JSON.stringify(session, null, 2);

      if (session.attachmentID) {
        // Update existing attachment
        const attachment = Zotero.Items.get(session.attachmentID);
        if (attachment) {
          const path = attachment.getFilePath();
          if (path) {
            await Zotero.File.putContentsAsync(path, jsonString);
            return;
          }
        }
      }

      // Create new attachment
      // Format title: "AI-Assistant-YYYYmmDDHHMMSS"
      const d = new Date(session.createdAt);
      const pad = (n: number) => n.toString().padStart(2, "0");
      const dateStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      const title = `AI-Assistant-${dateStr}`;

      // Create temp file
      const tempDir = Zotero.getTempDirectory().path;
      const sep = Zotero.isWin ? "\\" : "/";
      const tempPath = `${tempDir}${sep}${title}.json`;
      await Zotero.File.putContentsAsync(tempPath, jsonString);

      Zotero.debug(`[AI Assistant] Created temp file at: ${tempPath}`);

      // Import file as attachment using Zotero 7 API
      Zotero.debug(`[AI Assistant] Importing attachment from file...`);
      const attachment = await Zotero.Attachments.importFromFile({
        file: tempPath,
        parentItemID: parentItem.id,
        title: title,
        contentType: "application/json",
      });

      if (attachment) {
        session.attachmentID = attachment.id;
      }
    } catch (e) {
      Zotero.debug("[AI Assistant] Save Session Error: " + e);
      throw e;
    }
  }
}

export class ChatManager {
  static selectedSessionIDs = new Map<number, string>();
  static onAction:
    | ((text: string, action: "translate" | "explain") => Promise<void>)
    | null = null;

  static async handleExternalAction(
    text: string,
    action: "translate" | "explain",
  ) {
    if (this.onAction) {
      await this.onAction(text, action);
    } else {
      ztoolkit.getGlobal("alert")(
        "Please open the AI Assistant sidebar first.",
      );
    }
  }

  static registerPrefs() {
    Zotero.PreferencePanes.register({
      pluginID: addon.data.config.addonID,
      src: rootURI + "content/preferences.xhtml",
      label: getString("prefs-title"),
      image: `chrome://${addon.data.config.addonRef}/content/icons/robot.svg`,
    });
  }

  static registerChatSection() {
    const ROBOT_ICON = `chrome://${addon.data.config.addonRef}/content/icons/robot.svg`;
    Zotero.ItemPaneManager.registerSection({
      paneID: "zotero-llm-chat",
      pluginID: addon.data.config.addonID,
      header: {
        l10nID: getLocaleID("item-section-chat-header"),
        icon: ROBOT_ICON,
      },
      sidenav: {
        l10nID: getLocaleID("item-section-chat-sidenav"),
        icon: ROBOT_ICON,
      },
      bodyXHTML: "",
      onRender: async ({ body, item }) => {
        const doc = body.ownerDocument!;
        const NS = "http://www.w3.org/1999/xhtml";

        let container = body.querySelector(
          "#zotero-llm-chat-main",
        ) as HTMLElement;
        if (!container) {
          // Set body styles to help contain the child
          body.style.display = "flex";
          body.style.flexDirection = "column";
          body.style.height = "100%";
          body.style.minHeight = "400px"; // Minimum sensible height

          container = doc.createElementNS(NS, "div") as HTMLElement;
          container.id = "zotero-llm-chat-main";
          container.style.display = "flex";
          container.style.flexDirection = "column";
          // Use vh to ensure it stays within viewport
          container.style.height = "calc(100vh - 160px)";
          container.style.width = "100%";
          container.style.padding = "5px";
          container.style.boxSizing = "border-box";
          container.style.overflow = "hidden";
          body.appendChild(container);

          // Toolbar
          const toolbar = doc.createElementNS(NS, "div") as HTMLElement;
          toolbar.id = "zotero-llm-chat-toolbar";
          toolbar.style.display = "flex";
          toolbar.style.flexShrink = "0";
          toolbar.style.justifyContent = "space-between";
          toolbar.style.alignItems = "center";
          toolbar.style.flexWrap = "wrap";
          toolbar.style.gap = "5px";
          toolbar.style.paddingBottom = "5px";
          toolbar.style.borderBottom =
            "1px solid var(--material-divider, #ccc)";
          toolbar.style.marginBottom = "5px";
          container.appendChild(toolbar);

          const sessionSelect = doc.createElementNS(
            NS,
            "select",
          ) as HTMLSelectElement;
          sessionSelect.id = "zotero-llm-chat-session-select";
          sessionSelect.style.flex = "1 1 120px";
          sessionSelect.style.minWidth = "0";
          toolbar.appendChild(sessionSelect);

          const newBtn = doc.createElementNS(NS, "button") as HTMLButtonElement;
          newBtn.id = "zotero-llm-chat-new-btn";
          newBtn.textContent = "New Chat";
          newBtn.style.minWidth = "60px";
          newBtn.style.cursor = "pointer";
          toolbar.appendChild(newBtn);

          // Messages
          const messagesContainer = doc.createElementNS(
            NS,
            "div",
          ) as HTMLElement;
          messagesContainer.id = "zotero-llm-chat-messages";
          messagesContainer.style.flex = "1";
          messagesContainer.style.minHeight = "0";
          messagesContainer.style.overflowY = "auto";
          messagesContainer.style.marginBottom = "5px";
          messagesContainer.style.border =
            "1px solid var(--material-divider, #ccc)";
          messagesContainer.style.padding = "10px";
          messagesContainer.style.borderRadius = "4px";
          messagesContainer.style.backgroundColor =
            "var(--material-background, #f9f9f9)";
          messagesContainer.style.color = "var(--material-on-surface, black)";
          messagesContainer.style.display = "flex";
          messagesContainer.style.flexDirection = "column";
          messagesContainer.style.gap = "10px";
          messagesContainer.style.userSelect = "text";
          (messagesContainer.style as any).MozUserSelect = "text";
          container.appendChild(messagesContainer);

          // Input Area
          const inputArea = doc.createElementNS(NS, "div") as HTMLElement;
          inputArea.style.display = "flex";
          inputArea.style.flexShrink = "0";
          inputArea.style.gap = "5px";
          inputArea.style.alignItems = "stretch";
          inputArea.style.paddingTop = "5px";
          inputArea.style.backgroundColor = "transparent";
          container.appendChild(inputArea);

          const input = doc.createElementNS(
            NS,
            "textarea",
          ) as HTMLTextAreaElement;
          input.id = "zotero-llm-chat-input";
          input.placeholder = "Ask a question...";
          input.rows = 4;
          input.style.flex = "1";
          input.style.resize = "none";
          input.style.padding = "5px";
          input.style.borderRadius = "4px";
          input.style.border = "1px solid var(--material-divider, #ccc)";
          input.style.backgroundColor =
            "var(--material-side-bar-background, #fff)";
          input.style.color = "var(--material-on-surface, black)";
          inputArea.appendChild(input);

          // Right Controls
          const rightControls = doc.createElementNS(NS, "div") as HTMLElement;
          rightControls.style.display = "flex";
          rightControls.style.flexDirection = "column";
          rightControls.style.gap = "5px";
          rightControls.style.minWidth = "60px";
          inputArea.appendChild(rightControls);

          const fullTextContainer = doc.createElementNS(
            NS,
            "div",
          ) as HTMLElement;
          fullTextContainer.style.display = "flex";
          fullTextContainer.style.alignItems = "center";
          fullTextContainer.style.justifyContent = "center";

          const fullTextCheckbox = doc.createElementNS(
            NS,
            "input",
          ) as HTMLInputElement;
          fullTextCheckbox.type = "checkbox";
          fullTextCheckbox.id = "zotero-llm-chat-fulltext-checkbox";
          fullTextCheckbox.style.cursor = "pointer";
          fullTextCheckbox.style.margin = "0";

          const fullTextLabel = doc.createElementNS(
            NS,
            "label",
          ) as HTMLLabelElement;
          fullTextLabel.textContent = "Full Text";
          fullTextLabel.htmlFor = "zotero-llm-chat-fulltext-checkbox";
          fullTextLabel.style.fontSize = "10px";
          fullTextLabel.style.cursor = "pointer";
          fullTextLabel.style.marginLeft = "3px";

          fullTextContainer.appendChild(fullTextCheckbox);
          fullTextContainer.appendChild(fullTextLabel);
          rightControls.appendChild(fullTextContainer);

          const sendBtn = doc.createElementNS(
            NS,
            "button",
          ) as HTMLButtonElement;
          sendBtn.id = "zotero-llm-chat-send";
          sendBtn.textContent = "Send";
          sendBtn.style.flex = "1";
          sendBtn.style.cursor = "pointer";
          sendBtn.style.backgroundColor =
            "var(--material-side-bar-background, #eee)";
          sendBtn.style.border = "1px solid var(--material-divider, #ccc)";
          sendBtn.style.borderRadius = "4px";
          rightControls.appendChild(sendBtn);
        }

        const sendBtn = body.querySelector(
          "#zotero-llm-chat-send",
        ) as HTMLButtonElement;
        const newBtn = body.querySelector(
          "#zotero-llm-chat-new-btn",
        ) as HTMLButtonElement;
        const sessionSelect = body.querySelector(
          "#zotero-llm-chat-session-select",
        ) as HTMLSelectElement;
        const fullTextCheckbox = body.querySelector(
          "#zotero-llm-chat-fulltext-checkbox",
        ) as HTMLInputElement;
        const input = body.querySelector(
          "#zotero-llm-chat-input",
        ) as HTMLTextAreaElement;
        const messagesContainer = body.querySelector(
          "#zotero-llm-chat-messages",
        ) as HTMLDivElement;

        let currentSession: ChatSession | null = null;
        let currentSessions: ChatSession[] = [];
        let isProcessing = false;

        // --- Functions ---

        const renderMessages = (messages: ChatMessage[]) => {
          messagesContainer.innerHTML = "";
          if (messages.length === 0) {
            messagesContainer.innerHTML =
              '<div id="zotero-llm-chat-placeholder" style="opacity: 0.7; font-style: italic; text-align: center; margin-top: 10px;">Start a new conversation!</div>';
            return;
          }
          messages.forEach((msg) =>
            appendMessageUI(
              messagesContainer,
              msg.role,
              msg.content,
              msg.tokenCount,
              msg.promptTokenCount,
            ),
          );
        };

        const loadSessions = async () => {
          currentSessions = await StorageManager.getSessions(item);
          sessionSelect.innerHTML = "";
          currentSessions.sort((a, b) => b.createdAt - a.createdAt);

          if (currentSessions.length > 0) {
            currentSessions.forEach((s) => {
              const option = body.ownerDocument!.createElement("option");
              option.value = s.id;
              const dateStr = new Date(s.createdAt).toLocaleString();
              option.text = `[${dateStr}] ${s.title.substring(0, 30)}`;
              sessionSelect.appendChild(option);
            });

            const lastId = ChatManager.selectedSessionIDs.get(item.id);
            currentSession =
              currentSessions.find((s) => s.id === lastId) ||
              currentSessions[0];
            ChatManager.selectedSessionIDs.set(item.id, currentSession.id);
            sessionSelect.value = currentSession.id;
            renderMessages(currentSession.messages);
          } else {
            const option = body.ownerDocument!.createElement("option");
            option.text = "No history";
            sessionSelect.appendChild(option);
            sessionSelect.disabled = true;
            currentSession = null;
            renderMessages([]);
          }
          sessionSelect.disabled = currentSessions.length === 0;
        };

        const createNewSession = async () => {
          const newSession: ChatSession = {
            id: Zotero.Utilities.randomString(10),
            createdAt: Date.now(),
            title: "New Chat",
            messages: [],
          };
          currentSession = newSession;
          ChatManager.selectedSessionIDs.set(item.id, newSession.id);
          try {
            await StorageManager.saveSession(item, newSession);
            await loadSessions();
          } catch (e) {
            renderMessages([]);
          }
          input.focus();
        };

        const getFullText = async (item: Zotero.Item): Promise<string> => {
          // Collect all attachments to try
          const attachmentsToTry: Zotero.Item[] = [];

          if (item.isRegularItem()) {
            // Get all attachment IDs and try each one
            const attachmentIDs = item.getAttachments();
            for (const id of attachmentIDs) {
              const att = Zotero.Items.get(id);
              // Skip our own chat session attachments
              if (att && !att.getField("title").startsWith("AI-Assistant-")) {
                attachmentsToTry.push(att);
              }
            }
          } else if (item.isAttachment()) {
            attachmentsToTry.push(item);
          }

          // Collect full text from all attachments
          const fullTexts: string[] = [];
          for (const attachment of attachmentsToTry) {
            try {
              // Check if the attachment has been indexed
              const indexedState =
                await Zotero.Fulltext.getIndexedState(attachment);
              // INDEX_STATE_INDEXED: 3
              if (indexedState !== 3) {
                // Not indexed, run indexing first
                Zotero.debug(
                  `[AI Assistant] Attachment ${attachment.id}, ${attachment.getField("title")}, not indexed, indexing now...`,
                );
                await Zotero.Fulltext.indexItems([attachment.id]);
              }

              const cacheFile = Zotero.Fulltext.getItemCacheFile(attachment);
              // nsIFile.exists() is a synchronous method, no await needed
              if (cacheFile.exists()) {
                const content = await Zotero.File.getContentsAsync(
                  cacheFile.path,
                );
                if (content) {
                  fullTexts.push(content as string);
                }
              }
            } catch (e) {
              Zotero.debug(
                `[AI Assistant] getFullText error for attachment ${attachment.id}: ${e}`,
              );
            }
          }
          return fullTexts.join("\n");
        };

        // --- Event Listeners ---

        ChatManager.onAction = async (
          text: string,
          action: "translate" | "explain",
        ) => {
          const defaultTranslatePrompt =
            "Please translate the following text into Chinese:";
          const defaultExplainPrompt = "Please explain the following text:";
          let template = "";
          if (action === "translate") {
            template =
              (getPref("promptTranslate" as any) as string) ||
              defaultTranslatePrompt;
          } else if (action === "explain") {
            template =
              (getPref("promptExplain" as any) as string) ||
              defaultExplainPrompt;
          }
          if (!template || template === "undefined") {
            template =
              action === "translate"
                ? defaultTranslatePrompt
                : defaultExplainPrompt;
          }
          input.value = `${template}\n\n"${text}"`;
          sendBtn.click();
        };

        newBtn.onclick = async () => {
          await createNewSession();
        };

        sessionSelect.onchange = (e) => {
          const sessionId = (e.target as HTMLSelectElement).value;
          ChatManager.selectedSessionIDs.set(item.id, sessionId);
          const session = currentSessions.find((s) => s.id === sessionId);
          if (session) {
            currentSession = session;
            renderMessages(session.messages);
          }
        };

        input.onkeydown = (e) => {
          const keyEvent = e as unknown as KeyboardEvent;
          if (keyEvent.key === "Enter" && !keyEvent.shiftKey) {
            e.preventDefault();
            (sendBtn as HTMLElement).click();
          }
        };

        sendBtn.onclick = async () => {
          if (isProcessing) return;
          const question = input.value;
          if (!question.trim()) return;
          isProcessing = true;
          let loadingBubble: HTMLElement | null = null;
          try {
            if (!currentSession) {
              await createNewSession();
            }
            input.value = "";
            appendMessageUI(messagesContainer, "user", question);
            const userMsg: ChatMessage = { role: "user", content: question };
            currentSession!.messages.push(userMsg);
            if (currentSession!.messages.length === 1) {
              currentSession!.title =
                question.substring(0, 20) + (question.length > 20 ? "..." : "");
              await StorageManager.saveSession(item, currentSession!);
              await loadSessions();
            }
            const itemTitle = item.getField("title");
            const abstract = item.getField("abstractNote");
            let context = `Title: ${itemTitle}\nAbstract: ${abstract}`;
            const selectedText = getSelectedText();
            if (selectedText) {
              context += `\n\n[User Selected Text]:\n"${selectedText}"`;
              userMsg.content += `\n\n(Context: ${selectedText})`;
            }
            if (fullTextCheckbox && fullTextCheckbox.checked) {
              const fullText = await getFullText(item);
              if (fullText) {
                const limit =
                  (getPref("fullTextLimit" as any) as number) || 100000;
                context += `\n\n[Full Text Content]:\n${fullText.substring(0, limit)}`;
              }
            }
            loadingBubble = appendMessageUI(
              messagesContainer,
              "assistant",
              "Thinking...",
            );
            const { content: response, usage } = await callLLM(
              currentSession!.messages,
              context,
              (currentText) => {
                if (loadingBubble) {
                  updateMarkdownContainer(loadingBubble, currentText);
                  messagesContainer.scrollTop = messagesContainer.scrollHeight;
                }
              },
            );

            const assistantMsg: ChatMessage = {
              role: "assistant",
              content: response,
              tokenCount: usage?.completion_tokens,
              promptTokenCount: usage?.prompt_tokens,
            };
            currentSession!.messages.push(assistantMsg);
            await StorageManager.saveSession(item, currentSession!);
            renderMessages(currentSession!.messages);
          } catch (error) {
            const errorMsg = "Error: " + String(error);
            if (loadingBubble) {
              loadingBubble.textContent = errorMsg;
              loadingBubble.style.color = "red";
            } else {
              ztoolkit.getGlobal("alert")(errorMsg);
            }
          } finally {
            isProcessing = false;
            input.focus();
          }
        };

        await loadSessions();
      },
    });
  }
}

// --- Helpers ---

function getSelectedText(): string {
  const reader = Zotero.Reader.getByTabID(
    Zotero.getMainWindow().Zotero_Tabs.selectedID,
  );
  if (!reader) return "";
  const internalReader = reader._internalReader as any;
  if (internalReader?.lastSelectedText) {
    return internalReader.lastSelectedText;
  }
  const iframeWindow = (reader as any)._iframeWindow;
  if (iframeWindow) {
    const selection = iframeWindow.getSelection();
    if (selection && selection.toString()) {
      return selection.toString();
    }
  }
  return "";
}

function appendMessageUI(
  container: HTMLElement,
  role: string,
  text: string,
  tokenCount?: number,
  promptTokenCount?: number,
) {
  const doc = container.ownerDocument!;
  const wrapper = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLElement;
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.width = "100%";
  wrapper.style.marginBottom = "15px";
  wrapper.style.userSelect = "text";
  (wrapper.style as any).MozUserSelect = "text";

  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const timestamp = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLElement;
  timestamp.style.fontSize = "0.75em";
  timestamp.style.color = "#8e8e93";
  timestamp.style.marginBottom = "2px";
  timestamp.textContent = timeStr;

  const bubble = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLElement;
  bubble.style.maxWidth = "85%";
  bubble.style.padding = "8px 12px";
  bubble.style.borderRadius = "12px";
  bubble.style.wordWrap = "break-word";
  bubble.style.fontSize = "1em";
  bubble.style.lineHeight = "1.4";
  bubble.style.userSelect = "text";
  (bubble.style as any).MozUserSelect = "text";

  if (role === "user") {
    wrapper.style.alignItems = "flex-end";
    timestamp.style.marginRight = "4px";
    bubble.style.backgroundColor = "#007AFF";
    bubble.style.color = "white";
    bubble.style.borderBottomRightRadius = "2px";
  } else {
    wrapper.style.alignItems = "flex-start";
    timestamp.style.marginLeft = "4px";
    bubble.style.backgroundColor = "#F2F2F7";
    bubble.style.color = "black";
    bubble.style.borderBottomLeftRadius = "2px";
    bubble.style.border = "1px solid #E5E5EA";
  }

  let displayText = text;
  if (role === "user" && text.includes("\n\n(Context:")) {
    displayText = text.split("\n\n(Context:")[0];
  }

  if (role === "assistant") {
    // Render markdown for assistant messages
    updateMarkdownContainer(bubble, displayText);
    // Add styles for markdown content
    bubble.style.whiteSpace = "normal";
    const style = doc.createElement("style");
    style.textContent = `
      .zotero-llm-chat-bubble h1, .zotero-llm-chat-bubble h2, .zotero-llm-chat-bubble h3,
      .zotero-llm-chat-bubble h4, .zotero-llm-chat-bubble h5, .zotero-llm-chat-bubble h6 {
        margin: 0.5em 0 0.3em 0;
        line-height: 1.3;
      }
      .zotero-llm-chat-bubble h1 { font-size: 1.4em; }
      .zotero-llm-chat-bubble h2 { font-size: 1.2em; }
      .zotero-llm-chat-bubble h3 { font-size: 1.1em; }
      .zotero-llm-chat-bubble p { margin: 0.4em 0; }
      .zotero-llm-chat-bubble pre {
        background: rgba(0,0,0,0.05);
        padding: 8px;
        border-radius: 4px;
        overflow-x: auto;
        margin: 0.5em 0;
      }
      .zotero-llm-chat-bubble code {
        background: rgba(0,0,0,0.05);
        padding: 1px 4px;
        border-radius: 3px;
        font-family: monospace;
      }
      .zotero-llm-chat-bubble pre code {
        background: none;
        padding: 0;
      }
      .zotero-llm-chat-bubble ul, .zotero-llm-chat-bubble ol {
        margin: 0.5em 0;
        padding-left: 1.5em;
      }
      .zotero-llm-chat-bubble a {
        color: #007AFF;
        text-decoration: underline;
      }
      .zotero-llm-chat-bubble hr {
        border: none;
        border-top: 1px solid #ccc;
        margin: 0.5em 0;
      }
    `;
    if (!doc.getElementById("zotero-llm-markdown-styles")) {
      style.id = "zotero-llm-markdown-styles";
      if (doc.head) {
        doc.head.appendChild(style);
      }
    }
    bubble.classList.add("zotero-llm-chat-bubble");
  } else {
    bubble.textContent = displayText;
    bubble.style.whiteSpace = "pre-wrap";
  }

  wrapper.appendChild(timestamp);
  wrapper.appendChild(bubble);

  if (
    role === "assistant" &&
    (tokenCount !== undefined || promptTokenCount !== undefined)
  ) {
    const tokenDisplay = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    tokenDisplay.style.fontSize = "0.7em";
    tokenDisplay.style.color = "#aaa";
    tokenDisplay.style.marginTop = "2px";
    tokenDisplay.style.marginLeft = "4px";
    const inputStr =
      promptTokenCount !== undefined ? `Input: ${promptTokenCount}` : "";
    const outputStr = tokenCount !== undefined ? `Output: ${tokenCount}` : "";
    tokenDisplay.textContent =
      [inputStr, outputStr].filter((s) => s).join(" | ") + " tokens";
    wrapper.appendChild(tokenDisplay);
  }

  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
  return bubble;
}

async function callLLM(
  history: ChatMessage[],
  context: string,
  onUpdate: (chunk: string) => void,
): Promise<{
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}> {
  const apiUrl = getPref("apiUrl");
  const apiKey = getPref("apiKey");
  const model = getPref("model");
  if (!apiUrl || !apiKey) {
    throw new Error("Please check API configuration (URL or Key missing).");
  }
  const systemPrompt = `You are a helpful research assistant. Answer questions based on the provided paper abstract and any selected text context. If selected text is provided, prioritize it.\nPaper Context:\n${context}`;
  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API Error: ${response.status} - ${text}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";
  let usage: any = undefined;

  while (true) {
    const { done, value } = await (reader as any).read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const dataStr = line.slice(6).trim();
        if (dataStr === "[DONE]") continue;
        try {
          const data = JSON.parse(dataStr);
          if (data.choices?.[0]?.delta?.content) {
            fullContent += data.choices[0].delta.content;
            onUpdate(fullContent);
          }
          if (data.usage) {
            usage = data.usage;
          }
        } catch (e) {
          // Ignore partial JSON
        }
      }
    }
  }

  return { content: fullContent, usage };
}
