# jinjer Jinja Previewer for VS Code

Preview Jinja templates directly within VS Code. This extension leverages a built-in webview to render Jinja templates, simplifying the development process and eliminating the need for constant browser refreshes.

## Features

* Live Preview: See your Jinja templates rendered in real-time as you edit them. Changes are reflected instantly in the preview pane.
* Context Support: Define context variables within a dedicated configuration file to populate your templates with dynamic data. The extension supports JSON and YAML for defining context.
* Customizable Settings: Tailor the preview behavior to your preferences using global, workspace, or per-workspace settings files.
* Error Reporting: Clear error messages are displayed in the preview pane if issues occur during template rendering.
* Support for Includes and Macros: Preview Jinja templates that leverage includes, extends, and macros, with configurable search paths.

## Configuration

This extension offers several settings to customize its behavior. Settings can be configured at different levels, providing flexibility for individual preferences and project-specific requirements.

### Configuration Precedence

Jinjer resolves settings in the following order (highest precedence first):

1. **Per-Workspace Settings File** (e.g., `.jinjer-settings.json` in the workspace root, name configurable via `jinjer.settingsFile`)
2. **VS Code Workspace Settings** (defined in `.vscode/settings.json`)
3. **VS Code User (Global) Settings** (defined in your global `settings.json`)

This ensures that the most specific configuration for your project is always applied.

### VS Code Settings (User and Workspace Level)

You can configure the following settings directly in your VS Code `settings.json` (accessible via `Preferences: Open Settings (JSON)` or `Preferences: Open Workspace Settings (JSON)`):

* **`jinjer.contextFile`**:
  * Description: The name of the context file (JSON or YAML) to use for rendering Jinja templates. If the file is not found in the same directory as the template, parent directories will be searched up to the workspace root.
  * Default: `".jinjer.json"`
* **`jinjer.variableSuffix`**:
  * Description: If set (e.g., `"mydata"`), the context data will be wrapped under this key. For example, with `variableSuffix = "mydata"`, a template using `{{ mydata.variable }}` will render using the value from the context file key `"variable"`. An empty string means no suffix is applied.
  * Default: `""` (empty string)
* **`jinjer.customSearchPath`**:
  * Description: A string or an array of strings representing paths where Nunjucks (the Jinja engine) should look for templates during `{% include %}`, `{% extends %}`, or `{% import %}` operations. Paths should be relative to the workspace root. These are added to Nunjucks's search paths, which always includes the directory of the current template file by default.
  * Default: `undefined` (Nunjucks only searches relative to the current file)
* **`jinjer.settingsFile`**:
  * Description: Defines the name of the JSON file to be used for per-workspace Jinjer settings. This file allows for more granular, project-specific configurations that can be version-controlled.
  * Default: `".jinjer-settings.json"`

### Per-Workspace Settings File

For project-specific configurations that can be shared across a team or version-controlled, you can use a dedicated settings file in your workspace root. The name of this file is determined by the `jinjer.settingsFile` VS Code setting (defaulting to `.jinjer-settings.json`).

This JSON file can contain the following properties:

* **`contextFile`**:
  * Type: `string`
  * Description: Path to your context data file (JSON or YAML), relative to the workspace root. This overrides the `jinjer.contextFile` setting from VS Code's global or workspace settings.
  * Example: `"src/data/template-context.yaml"`
* **`variableSuffix`**:
  * Type: `string`
  * Description: A string under which your context variables will be namespaced (e.g., `"cc"` for `{{ cc.variable }}`). An empty string (`""`) means no namespacing. This overrides the `jinjer.variableSuffix` from VS Code settings.
  * Example: `"page_data"`
* **`customSearchPath`**:
  * Type: `string | string[]`
  * Description: A path or an array of paths (relative to the workspace root) where Nunjucks should look for templates during `{% include %}`, `{% extends %}`, or `{% import %}` operations. These paths are added to Nunjucks's search list. This overrides the `jinjer.customSearchPath` from VS Code settings.
  * Example (single path): `"templates/includes"`
  * Example (multiple paths): `["includes/", "shared_components/jinja"]`

#### Example `.jinjer-settings.json`

```json
{
  "contextFile": "src/data/context.json",
  "variableSuffix": "site",
  "customSearchPath": [
    "src/templates/includes",
    "src/templates/layouts"
  ]
}
```

#### Benefits of Per-Workspace Settings

* **Project-Specific Configurations**: Tailor Jinjer's behavior to the specific needs and directory structure of each project.
* **Team Collaboration**: Share consistent rendering settings across a team by committing this file to version control.
* **Simplified Setup**: New contributors can get started quickly with pre-defined project settings, ensuring consistent preview behavior.

## Known Issues

* Complex Jinja features that rely on external Python dependencies or system-level access might not be fully supported within the preview, as it uses Nunjucks (a JavaScript port of Jinja).
* Performance might be affected when working with very large or complex templates.

## Release Notes

See the CHANGELOG for the latest release notes.

## Contributing

Contributions are welcome! Feel free to open issues and submit pull requests.

## License

This extension is licensed under the MIT License.
