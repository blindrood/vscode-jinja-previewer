import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

suite('Jinja Previewer Extension Tests', () => {
    vscode.window.showInformationMessage('Starting Jinja Previewer tests.');

    // Test setup - create a dummy template file and context file
    const testWorkspaceFolder = vscode.workspace.workspaceFolders?.[0]; // Get the workspace folder
    if (!testWorkspaceFolder) {
        console.error("No workspace folder found. Skipping tests.");
        return; // Stop tests if no workspace folder
    }

    const templateFileUri = vscode.Uri.joinPath(testWorkspaceFolder.uri, 'test_template.jinja');
    const contextFileUri = vscode.Uri.joinPath(testWorkspaceFolder.uri, '.jinjer.yaml');

    setup(async () => {
        if (testWorkspaceFolder) { // Only write files if workspace folder exists
            await fs.promises.writeFile(templateFileUri.fsPath, 'Hello {{ name }}!');
            await fs.promises.writeFile(contextFileUri.fsPath, 'name: World');
        }
    });


    teardown(async () => { // Clean up test files after each test
        try {
            await fs.promises.unlink(templateFileUri.fsPath);
            await fs.promises.unlink(contextFileUri.fsPath);
        } catch (e) {
            console.error(`Failed to delete test files: ${e}`);
        }
    });


    // test('Preview command should update webview content', async () => {
    //     // Open a test file
    //     const doc = await vscode.workspace.openTextDocument({language: 'jinja', content: 'Hello {{ world }}'});
    //     await vscode.window.showTextDocument(doc);

    //     // Set up a mock context file (if needed for the test)

    //     // Execute the command
    //     await vscode.commands.executeCommand('jinjer.preview');

    //     const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    //     await delay(500); // Example, adjust as needed

    //     // Get the webview panel (you might need to find it in the window's webviews)
    //     const webviewPanel = vscode.window.tabGroups.all.flatMap(group => group.tabs
    //         .filter((tab): tab is vscode.Tab & {input: vscode.WebviewView} => (
    //             tab.input instanceof vscode.WebviewView && tab.input.viewType === 'jinjaPreview' // Use the correct viewType
    //         ))
    //         .map(tab => tab.input.webviewPanel)
    //     )[0];

    //     assert.ok(webviewPanel?.webview.html.includes("Hello "));

    //     // Clean up - Close the panel (important!)
    //     panel?.dispose();
    // });

    // Add more tests for different scenarios (e.g., invalid context, missing context file, errors in template)
});


