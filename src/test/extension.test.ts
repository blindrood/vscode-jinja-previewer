import assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as myExtension from '../extension'; // Import your extension

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


    test('Preview renders correctly with context', async () => {
        const doc = await vscode.workspace.openTextDocument(templateFileUri);
        await vscode.window.showTextDocument(doc); // Open in editor to activate extension

        // Wait for the preview to render (you might need to adjust the timeout)
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Get the webview content
        const panel = myExtension.getPanel();  // Assuming getPanel is exported from your extension
        assert(panel, "Webview panel not found");
        if (!panel) {return;}; // Prevent type error
        const renderedHtml = panel.webview.html;

        assert.ok(renderedHtml.includes('Hello World!'), 'Rendered HTML does not contain expected output');
    });

    test('Preview updates on template change', async () => {
        // ... (similar setup as above)

        const doc = await vscode.workspace.openTextDocument(templateFileUri);
        const editor = await vscode.window.showTextDocument(doc);

        // Make a change to the template
        const newTemplateContent = 'Goodbye {{ name }}!';
        const edit = new vscode.WorkspaceEdit();
        edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), newTemplateContent);
        await vscode.workspace.applyEdit(edit);
        await doc.save();

        // Wait for preview update
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Verify update
        const panel = myExtension.getPanel();
        assert(panel, "Webview panel not found");
        if (!panel) {return;}; // Prevent type error
        const updatedHtml = panel.webview.html;
        assert.ok(updatedHtml.includes('Goodbye World!'), 'Preview did not update correctly');
    });

    // Add more tests for different scenarios (e.g., invalid context, missing context file, errors in template)
});


