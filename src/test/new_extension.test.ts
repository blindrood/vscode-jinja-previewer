import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as path from 'path';
import { activate, deactivate } from '../extension';

// Helper to delay execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

suite('Extension Test Suite', () => {
    let stubs: sinon.SinonStub[] = [];

    teardown(() => {
        stubs.forEach(stub => stub.restore());
        stubs = [];
        if (deactivate) {
            deactivate();
        }
    });

    async function setupAndPreview(templateContent: string, templateFileName: string = 'test.jinja') {
        const docUri = vscode.Uri.file(path.resolve('/fake/workspace', templateFileName));

        const mockEditor = {
            document: {
                uri: docUri,
                fileName: docUri.fsPath,
                getText: () => templateContent,
                languageId: 'jinja',
            },
        };

        const activeTextEditorStub = sinon.stub(vscode.window, 'activeTextEditor').value(mockEditor);
        stubs.push(activeTextEditorStub);

        const mockWebviewPanel = {
            webview: {
                html: '',
                asWebviewUri: (uri: vscode.Uri) => uri,
            },
            reveal: sinon.stub(),
            onDidDispose: sinon.stub(),
        };
        const createWebviewPanelStub = sinon.stub(vscode.window, 'createWebviewPanel').returns(mockWebviewPanel as any);
        stubs.push(createWebviewPanelStub);

        const mockContext: vscode.ExtensionContext = {
            subscriptions: [],
            workspaceState: { get: () => {}, update: () => Promise.resolve(), keys: () => [] } as vscode.Memento,
            globalState: { get: () => {}, update: () => Promise.resolve(), keys: () => [] } as vscode.Memento,
            extensionPath: '/fake/extension/path',
            storagePath: '/fake/storage/path',
            logPath: '/fake/log/path',
            asAbsolutePath: (relativePath: string) => path.resolve('/fake/extension/path', relativePath),
        } as any;

        activate(mockContext);

        await vscode.commands.executeCommand('jinjer.preview');
        await delay(100);

        return mockWebviewPanel;
    }

    test('Should render a simple template', async () => {
        const template = '<h1>Hello World</h1>';
        const panel = await setupAndPreview(template);
        assert.ok(panel.webview.html.includes(template), `HTML was: ${panel.webview.html}`);
    });

    test('Should load context from .jinjer.json', async () => {
        const template = '<h1>Hello {{ name }}</h1>';
        const context = { name: 'World' };

        // Mocking fs.readFileSync
        const readFileSyncStub = sinon.stub(require('fs'), 'readFileSync');
        readFileSyncStub.withArgs(path.resolve('/fake/workspace/.jinjer.json')).returns(JSON.stringify(context));
        stubs.push(readFileSyncStub);

        const panel = await setupAndPreview(template);
        assert.ok(panel.webview.html.includes('<h1>Hello World</h1>'), `HTML was: ${panel.webview.html}`);
    });

    test('Should respect workspace settings', async () => {
        const template = '<h1>Hello {{ name }}</h1>';
        const context = { name: 'World' };
        const workspaceSettings = {
            contextFile: 'workspace.json'
        };

        // Mocking vscode.workspace.getConfiguration to return global settings
        const getConfigurationStub = sinon.stub(vscode.workspace, 'getConfiguration').returns({
            get: (key: string) => {
                if (key === 'contextFile') {
                    return 'global.json';
                }
            },
        } as any);
        stubs.push(getConfigurationStub);

        const readFileSyncStub = sinon.stub(require('fs'), 'readFileSync');
        // Workspace settings file
        readFileSyncStub.withArgs(path.resolve('/fake/workspace/.jinjer-settings.json')).returns(JSON.stringify(workspaceSettings));
        // Workspace context file
        readFileSyncStub.withArgs(path.resolve('/fake/workspace/workspace.json')).returns(JSON.stringify(context));
        stubs.push(readFileSyncStub);

        const panel = await setupAndPreview(template);
        assert.ok(panel.webview.html.includes('<h1>Hello World</h1>'), `HTML was: ${panel.webview.html}`);
    });

    test('Should handle includes', async () => {
        const template = '{% include "other.jinja" %}';
        const otherTemplate = '<h1>Included</h1>';

        const readFileSyncStub = sinon.stub(require('fs'), 'readFileSync');
        readFileSyncStub.withArgs(path.resolve('/fake/workspace/other.jinja')).returns(otherTemplate);
        stubs.push(readFileSyncStub);

        const panel = await setupAndPreview(template);
        assert.ok(panel.webview.html.includes(otherTemplate), `HTML was: ${panel.webview.html}`);
    });

    test('Should respect custom context file setting', async () => {
        const template = '<h1>Hello {{ name }}</h1>';
        const context = { name: 'World' };

        // Mocking vscode.workspace.getConfiguration
        const getConfigurationStub = sinon.stub(vscode.workspace, 'getConfiguration').returns({
            get: (key: string) => {
                if (key === 'contextFile') {
                    return 'custom.json';
                }
            },
        } as any);
        stubs.push(getConfigurationStub);

        const readFileSyncStub = sinon.stub(require('fs'), 'readFileSync');
        readFileSyncStub.withArgs(path.resolve('/fake/workspace/custom.json')).returns(JSON.stringify(context));
        stubs.push(readFileSyncStub);

        const panel = await setupAndPreview(template);
        assert.ok(panel.webview.html.includes('<h1>Hello World</h1>'), `HTML was: ${panel.webview.html}`);
    });
});
