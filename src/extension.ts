import * as vscode from 'vscode';
import * as nunjucks from 'nunjucks';
import * as yaml from 'js-yaml';

let panel: vscode.WebviewPanel | undefined;
let activeDocument: vscode.TextDocument | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('✅ Jinjer Extension Activated!');

    let disposable = vscode.commands.registerCommand('jinjer.preview', async () => {
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

        const updateWebview = async () => {
            if (!panel || !activeDocument) return;
            try {
                console.log("🔄 Updating preview...");
                const contextData = await getContextData(activeDocument);
                const templateContent = activeDocument.getText();
                const renderedHtml = `<pre>${nunjucks.renderString(templateContent, contextData)}</pre>`;

                panel.webview.html = getWebviewHtml(renderedHtml);
                console.log("✅ Updated preview successfully!");
            } catch (error) {
                panel.webview.html = getWebviewHtml(`<pre style="color: red;">${error}</pre>`);
                console.error("❌ Nunjucks Render Error:", error);
            }
        };

        await updateWebview();

        // ✅ Confirm event fires
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

function getWebviewHtml(content: string) {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Jinja Preview</title>
            <style>
                body { font-family: sans-serif; }
                pre { white-space: pre-wrap; word-wrap: break-word; font-family: monospace; }
            </style>
        </head>
        <body>
            ${content}
        </body>
        </html>
    `;
}

async function getContextData(document: vscode.TextDocument): Promise<any> {
    const config = vscode.workspace.getConfiguration('jinjer');
    const contextPath = config.get('contextFile') as string | undefined;
    let contextData = {};

    if (contextPath) {
        try {
            const contextUri = vscode.Uri.joinPath(document.uri, contextPath);
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
    }

    return contextData;
}

export function deactivate() {}
