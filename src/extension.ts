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

        // Update the preview initially
        await updateWebview();

        // Update preview when the document changes
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document === activeDocument) {
                console.log("📢 Detected document change! Updating preview...");
                updateWebview();
            }
        });

        // Update preview when switching active editors
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                activeDocument = editor.document;
                updateWebview();
            }
        });

        // Optionally, you could set up a file watcher for the context file here
        // (if you want live updates when the context file changes)
    });

    context.subscriptions.push(disposable);

    async function updateWebview() {
        if (!panel || !activeDocument) {
            return;
        }
        try {
            console.log("🔄 Updating preview...");
            const contextData = await getContextData(activeDocument);
            const templateContent = activeDocument.getText();

            // Configure nunjucks to preserve whitespace/newlines
            const env = nunjucks.configure({
                autoescape: true,
                trimBlocks: false,
                lstripBlocks: false
            });
            const renderedHtml = env.renderString(templateContent, contextData);

            // Set the webview HTML with the rendered (and escaped) content
            panel.webview.html = getWebviewHtml(renderedHtml, activeDocument);
            console.log("✅ Updated preview successfully!");
        } catch (error) {
            panel.webview.html = getWebviewHtml(`<pre style="color: red;">${error}</pre>`, activeDocument);
            console.error("❌ Nunjucks Render Error:", error);
        }
    }
}

function getWebviewHtml(content: string, document: vscode.TextDocument): string {
    const extension = getExtension(document.fileName);
    // You can use mapExtensionToPrism(extension) if you support multiple languages.
    // For now, we're hardcoding JSON for testing.
    const languageId = "json";

    // Content Security Policy: allow inline scripts/styles from cdnjs
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

function getExtension(filename: string): string {
    return filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
}

function mapExtensionToPrism(extension: string): string {
    const prismMap: { [key: string]: string } = {
        "js": "javascript",
        "ts": "typescript",
        "json": "json",
        "yml": "yaml",
        "yaml": "yaml",
        "html": "html",
        "css": "css",
        "scss": "scss",
        "md": "markdown",
        "py": "python",
        "java": "java",
        "c": "c",
        "cpp": "cpp",
        "cs": "csharp",
        "go": "go",
        "php": "php",
        "rb": "ruby",
        "rs": "rust",
        "sh": "bash",
        "xml": "xml",
        "sql": "sql"
    };
    return prismMap[extension] || "plaintext";
}

// Escape special HTML characters but preserve newline characters.
function escapeHtml(content: string): string {
    return content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function prismCSS(): string {
    return `
        /* Prism.js Theme: Tomorrow Night */
        code[class*="language-"], pre[class*="language-"] {
            color: #ccc;
            background: none;
            font-family: Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace;
            font-size: 1em;
            text-align: left;
            white-space: pre;
            word-spacing: normal;
            word-break: normal;
            line-height: 1.5;
            tab-size: 4;
            hyphens: none;
        }
        pre[class*="language-"] { padding: 1em; margin: 0; overflow: auto; }
        .token.comment, .token.prolog, .token.doctype, .token.cdata { color: #999; }
        .token.punctuation { color: #ccc; }
        .token.property, .token.tag, .token.constant, .token.symbol, .token.deleted { color: #e2777a; }
        .token.boolean, .token.number { color: #f08d49; }
        .token.selector, .token.attr-name, .token.string, .token.char, .token.builtin, .token.inserted { color: #abe338; }
        .token.operator, .token.entity, .token.url, .language-css .token.string, .style .token.string { color: #67cdcc; }
        .token.atrule, .token.attr-value, .token.keyword { color: #c678dd; }
        .token.function { color: #6196cc; }
        .token.regex, .token.important, .token.variable { color: #e90; }
        .token.important, .token.bold { font-weight: bold; }
        .token.italic { font-style: italic; }
        .token.entity { cursor: help; }
    `;
}

async function getContextData(document: vscode.TextDocument): Promise<any> {
    const config = vscode.workspace.getConfiguration('jinjer');
    // Get the context file from configuration. For example, ".jinjer.json" or ".jinjer.yaml"
    let contextPath = config.get('jinjer.contextFile') as string | undefined;
    let contextData = {};

    if (contextPath) {
        try {
            // Resolve the context file relative to the active document's directory.
            const contextUri = vscode.Uri.joinPath(document.uri, '..', contextPath);
            const contextFile = await vscode.workspace.fs.readFile(contextUri);
            const contextString = Buffer.from(contextFile).toString('utf8');
            if (contextPath.endsWith('.json')) {
                contextData = JSON.parse(contextString);
            } else if (contextPath.endsWith('.yaml') || contextPath.endsWith('.yml')) {
                contextData = yaml.load(contextString) as any;
            } else {
                vscode.window.showWarningMessage('Unsupported context file format. Please use .json or .yaml');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error reading context file: ${error}`);
        }
    } else {
        console.log("No context file configured. Using empty context.");
    }

    return contextData;
}

export function getPanel(): vscode.WebviewPanel | undefined {
    return panel;
}

export function deactivate() {}
