import * as vscode from 'vscode';
import * as nunjucks from 'nunjucks';
import * as yaml from 'js-yaml';

let panel: vscode.WebviewPanel | undefined;
let activeDocument: vscode.TextDocument | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('✅ Jinjer Extension Activated!');

    const disposable = vscode.commands.registerCommand('jinjer.preview', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor.');
            return;
        }

        activeDocument = editor.document;

        // Reuse existing panel or create a new one.
        if (panel) {
            panel.reveal(vscode.ViewColumn.Two);
        } else {
            panel = vscode.window.createWebviewPanel(
                'jinjaPreview',
                'Jinja Preview',
                vscode.ViewColumn.Two,
                { enableScripts: true }
            );
            panel.onDidDispose(() => {
                panel = undefined;
            });
        }

        // Function to update the preview
        const updateWebview = async () => {
            if (!panel || !activeDocument) {
                return;
            }
            try {
                console.log("🔄 Updating preview...");
                const contextData = await getContextData(activeDocument);
                const templateContent = activeDocument.getText();

                // Configure nunjucks to preserve whitespace/newlines.
                const env = nunjucks.configure({
                    autoescape: true,
                    trimBlocks: false,
                    lstripBlocks: false
                });
                const renderedHtml = env.renderString(templateContent, contextData);

                // Set the webview HTML with the rendered and escaped content.
                panel.webview.html = getWebviewHtml(renderedHtml, activeDocument);
                console.log("✅ Updated preview successfully!");
            } catch (error) {
                panel.webview.html = getWebviewHtml(
                    `<pre style="color: red;">${error}</pre>`,
                    activeDocument
                );
                console.error("❌ Nunjucks Render Error:", error);
            }
        };

        await updateWebview();

        // Update preview when the document changes.
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document === activeDocument) {
                console.log("📢 Detected document change! Updating preview...");
                updateWebview();
            }
        });

        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                activeDocument = editor.document;
                updateWebview();
            }
        });
    });

    context.subscriptions.push(disposable);
}

function getWebviewHtml(content: string, document: vscode.TextDocument): string {
    // Determine the language based on the file extension.
    const extension = getExtension(document.fileName);
    // For this version, we are hardcoding JSON since you tested with a JSON file.
    // (You can replace "json" with mapExtensionToPrism(extension) if you support multiple languages.)
    const languageId = "json";

    // Define the Content Security Policy to allow inline scripts/styles from cdnjs.
    const csp = `
        default-src 'none';
        script-src 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com;
        style-src 'unsafe-inline' https://cdnjs.cloudflare.com;
        img-src 'self';
        font-src 'self';
        connect-src 'self';
    `;

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta http-equiv="Content-Security-Policy" content="${csp}">
          <title>Jinja Preview</title>
          <style>
              body { font-family: sans-serif; padding: 10px; }
              pre { white-space: pre-wrap; word-wrap: break-word; font-family: monospace; }
              code { font-size: 14px; display: block; }
              ${prismCSS()}
          </style>
          <!-- Load Prism core and the JSON language definition -->
          <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.28.0/prism.min.js"></script>
          <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.28.0/components/prism-json.min.js"></script>
          <script>
            // When the window loads, trigger syntax highlighting.
            window.addEventListener('load', function() {
              Prism.highlightAll();
            });
          </script>
        </head>
        <body>
          <pre><code class="language-${languageId}">${escapeHtml(content)}</code></pre>
        </body>
        </html>
    `;
}

// Extracts the file extension from the filename.
function getExtension(filename: string): string {
    return filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
}

// Maps file extensions to Prism language identifiers.
function mapExtensionToPrism(extension: string): string {
    const prismMap: { [key: string]: string } = {
        "js": "javascript",
        "ts": "typescript",
        "json": "json",
        "yml": "yaml",
        "yaml": "yaml",
        "html": "html",
        "css
