import { ChatManager } from "./chat";

export class ReaderManager {
  static init() {
    Zotero.Reader.registerEventListener(
      "renderTextSelectionPopup",
      (event) => {
        const { doc, append, reader, params } = event;
        const text = params.annotation.text; // Get text directly from event params

        Zotero.debug(
          `[AI Assistant] Popup rendered. Text from params: "${text?.substring(0, 30)}..."`,
        );

        const btnGroup = doc.createElement("div");
        btnGroup.className = "ai-assistant-btn-group";
        btnGroup.style.display = "flex";
        btnGroup.style.gap = "5px";
        btnGroup.style.marginTop = "5px";
        btnGroup.style.padding = "5px";
        btnGroup.style.borderTop = "1px solid #ccc";

        const createBtn = (label: string, action: "translate" | "explain") => {
          const btn = doc.createElement("button");
          btn.textContent = label;
          btn.style.fontSize = "12px";
          btn.style.padding = "2px 5px";
          btn.style.cursor = "pointer";
          btn.style.backgroundColor = "#f0f0f0";
          btn.style.border = "1px solid #ccc";
          btn.style.borderRadius = "3px";

          btn.onclick = async (e) => {
            Zotero.debug(`[AI Assistant] Button clicked: ${action}`);
            try {
              if (text) {
                Zotero.debug(
                  `[AI Assistant] Calling ChatManager.handleExternalAction...`,
                );
                if (typeof ChatManager === "undefined") {
                  Zotero.debug(
                    `[AI Assistant] Error: ChatManager is undefined!`,
                  );
                } else {
                  await ChatManager.handleExternalAction(text, action);
                }
              } else {
                Zotero.debug(`[AI Assistant] Error: No text found in params.`);
              }
            } catch (error) {
              Zotero.debug(
                `[AI Assistant] Error in button click handler: ${error}`,
              );
              Zotero.debug(String(error));
            }
          };
          return btn;
        };

        btnGroup.appendChild(createBtn("AI Translate", "translate"));
        btnGroup.appendChild(createBtn("AI Explain", "explain"));

        append(btnGroup);
      },
      addon.data.config.addonID,
    );
  }

  static getSelectedText(reader: _ZoteroTypes.ReaderInstance): string {
    const internalReader = reader._internalReader as any;
    if (internalReader?.lastSelectedText) {
      return internalReader.lastSelectedText;
    }

    // Fallback to iframe selection if internal property missing
    const iframeWindow = (reader as any)._iframeWindow;
    if (iframeWindow) {
      const selection = iframeWindow.getSelection();
      if (selection && selection.toString()) {
        return selection.toString();
      }
    }
    return "";
  }
}
