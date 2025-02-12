import * as vscode from 'vscode';
import * as nunjucks from 'nunjucks';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { promises as fs } from 'fs';

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

        await updateWebview();

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

        vscode.workspace.onDidSaveTextDocument(async (document) => {
            const config = vscode.workspace.getConfiguration('jinjer');
            const contextPath = config.get<string>('contextFile');
            if (contextPath && document.fileName.endsWith(contextPath)) {
                console.log(`📢 Context file ${document.fileName} saved! Reloading context...`);
                await updateWebview();
            }
        });
    });

    context.subscriptions.push(disposable);

    async function updateWebview() {
        if (!panel || !activeDocument) {
            return;
        }
        try {
            console.log("🔄 Updating preview...");
            const contextData = await getContextData(activeDocument);
            console.log("📢 Loaded context data:", contextData);
            const templateContent = activeDocument.getText();

            const env = nunjucks.configure({
                autoescape: true,
                trimBlocks: false,
                lstripBlocks: false
            });
            const renderedHtml = env.renderString(templateContent, contextData);

            if (panel) {
                panel.webview.html = getWebviewHtml(renderedHtml, activeDocument);
                console.log("✅ Updated preview successfully!");
            }
        } catch (error) {
            if (panel) {
                panel.webview.html = getWebviewHtml(`<pre style="color: red;">${error}</pre>`, activeDocument);
            }
            console.error("❌ Nunjucks Render Error:", error);
        }
    }
}

function getWebviewHtml(content: string, document: vscode.TextDocument): string {
    const extension = getExtension(document.fileName);
    const languageId = mapExtensionToPrism(extension);

    // Content Security Policy
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
          <!-- Load Prism core -->
          <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.28.0/prism.min.js"></script>
          <!-- Load Prism autoloader plugin -->
          <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.28.0/plugins/autoloader/prism-autoloader.min.js"></script>
          <script>
            // Configure the autoloader plugin
            Prism.plugins.autoloader.languages_path = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.28.0/components/';
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
    const contextFileName = config.get<string>('contextFile') || ".jinjer.json";
    let contextData = {};

    if (contextFileName) {
        try {
            const contextFileUri = await findContextFile(document.uri, contextFileName);

            if (contextFileUri) {
                const contextFile = await vscode.workspace.fs.readFile(contextFileUri);
                const contextString = Buffer.from(contextFile).toString('utf8');
                if (contextFileName.endsWith('.json')) {
                    contextData = JSON.parse(contextString);
                } else if (contextFileName.endsWith('.yaml') || contextFileName.endsWith('.yml')) {
                    contextData = yaml.load(contextString) as any;
                } else {
                    vscode.window.showWarningMessage('Unsupported context file format. Please use .json or .yaml');
                }
            } else {
                console.log(`Context file "${contextFileName}" not found.`);
            }

        } catch (error) {
            vscode.window.showErrorMessage(`Error reading context file: ${error}`);
            console.error("❌ Error loading context file:", error);
        }
    }

    return contextData;
}

async function findContextFile(startUri: vscode.Uri, contextFileName: string): Promise<vscode.Uri | undefined> {
    let currentUri = startUri;
    let workspaceFolder = vscode.workspace.getWorkspaceFolder(startUri);

    while (workspaceFolder && currentUri.path !== workspaceFolder.uri.path) {
        const contextUri = vscode.Uri.joinPath(currentUri, contextFileName);
        try {
            await fs.access(contextUri.fsPath); // Check if file exists
            return contextUri;
        } catch {
            // File not found, move up one directory
            const currentPath = currentUri.path;
            const parentPath = path.dirname(currentPath);
            currentUri = vscode.Uri.file(parentPath);

        }
    }
    return undefined; // File not found within the workspace folder
}

export function deactivate() {}
