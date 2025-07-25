import { defineConfig } from '@vscode/test-cli';

import path from 'path';

export default defineConfig({
	files: 'out/test/new_extension.test.js',
	workspaceFolder: path.resolve(process.cwd(), 'src/test/testFixture/mockWorkspace'),
});
