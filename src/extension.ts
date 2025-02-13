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
                console.log("Jinjer: 📢 Detected document change! Updating preview...");
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
            console.log("Jinjer: 🔄 Updating preview...");
            const contextData = await getContextData(activeDocument);
            console.log("Jinjer: 📢 Loaded context data:", contextData);
            const templateContent = activeDocument.getText();

            const env = nunjucks.configure({
                autoescape: true,
                trimBlocks: false,
                lstripBlocks: false
            });
            const renderedHtml = env.renderString(templateContent, contextData);

            if (panel) {
                panel.webview.html = getWebviewHtml(renderedHtml, activeDocument);
                console.log("Jinjer: ✅ Updated preview successfully!");
            }
        } catch (error) {
            if (panel) {
                panel.webview.html = getWebviewHtml(`<pre style="color: red;">${error}</pre>`, activeDocument);
            }
            console.error("Jinjer: ❌ Nunjucks Render Error:", error);
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
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.28.0/themes/prism-tomorrow.min.css">
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

async function getContextData(document: vscode.TextDocument): Promise<any> {
    const config = vscode.workspace.getConfiguration('jinjer');
    const contextFileName = config.get<string>('contextFile') || ".jinjer.json";

    console.log(`Jinjer: 📂 Looking for context file: ${contextFileName}`);

    const contextFileUri = await findContextFile(document.uri, contextFileName);

    if (!contextFileUri) {
        console.error(`Jinjer: ❌ Context file "${contextFileName}" not found.`);
        return {};  // Return empty object to avoid crashes
    }

    let contextData = {};
    try {
        const contextFile = await vscode.workspace.fs.readFile(contextFileUri);
        const contextString = Buffer.from(contextFile).toString('utf8');

        if (contextFileName.endsWith('.json')) {
            contextData = JSON.parse(contextString);
        } else if (contextFileName.endsWith('.yaml') || contextFileName.endsWith('.yml')) {
            contextData = yaml.load(contextString) as any;
        } else {
            vscode.window.showWarningMessage('Unsupported context file format. Please use .json or .yaml');
        }

        console.log("Jinjer: ✅ Successfully loaded context data:", contextData);

    } catch (error) {
        vscode.window.showErrorMessage(`Error reading context file: ${error}`);
        console.error("Jinjer: ❌ Error loading context file:", error);
    }

    // Check and apply variable suffix
    const variableSuffix = config.get<string>('variableSuffix', "cookiecutter");
    console.log(`Jinjer: 🔍 Retrieved variableSuffix: "${variableSuffix}"`);

    if (variableSuffix) {
        contextData = { [variableSuffix]: contextData };
        console.log("Jinjer: ✅ Applied variable suffix:", contextData);
    } else {
        console.log("Jinjer: ❌ Suffix not set, using direct context data.");
    }

    return contextData;
}

async function findContextFile(startUri: vscode.Uri, contextFileName: string): Promise<vscode.Uri | undefined> {
    let currentUri = vscode.Uri.file(path.dirname(startUri.fsPath));
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(startUri);

    if (!workspaceFolder) {
        console.error("Jinjer: ❌ No workspace folder found!");
        return undefined;
    }

    while (true) {
        const contextUri = vscode.Uri.joinPath(currentUri, contextFileName);
        try {
            await fs.access(contextUri.fsPath);
            return contextUri;
        } catch {}

        if (currentUri.fsPath === workspaceFolder.uri.fsPath) {break;};

        const parentPath = path.dirname(currentUri.fsPath);
        if (parentPath === currentUri.fsPath) {break;};

        currentUri = vscode.Uri.file(parentPath);
    }

    console.warn(`Jinjer: ❌ Context file "${contextFileName}" not found.`);
    return undefined;
}

export function deactivate() {}
