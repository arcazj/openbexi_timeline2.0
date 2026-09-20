import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export async function collectHelpContent(root) {
  const inputs = {};
  const read = async file => {
    const data = await readFile(path.join(root, file));
    inputs[file] = createHash('sha256').update(data).digest('hex');
    return data.toString('utf8');
  };
  const names = {
    'docs/README.md': 'Documentation',
    'docs/openbexi_timeline2.0_user_manual.md': 'User manual',
    'openbexi_timeline2.0_current_prompt.md': 'Current prompt',
    'docs/openbexi_timeline2.0_prompt_history.md': 'Prompt history',
    'docs/openbexi_timeline2.0_design.md': 'Design',
    'docs/openbexi_timeline2.0_data_design.md': 'Data design',
    'docs/openbexi_timeline2.0_architecture.md': 'Architecture',
    'docs/openbexi_timeline2.0_tests.md': 'Tests',
    'docs/openbexi_timeline2.0_deployment.md': 'Deployment',
    'README.md': 'README', 'docs/release-history.md': 'Release history',
    'docs/third-party-notices.md': 'Licenses', 'docs/reference/implementation/api.md': 'API guide',
    'docs/reference/implementation/api-contract.md': 'OpenAPI contract', 'docs/reference/implementation/local-source-paths.md': 'Server YAML and sources',
    'docs/reference/implementation/local-scaling.md': 'Local scaling', 'docs/reference/implementation/standalone-mode.md': 'Standalone mode',
    'docs/reference/implementation/implementation-status.md': 'Implementation status', 'docs/reference/implementation/testing.md': 'Testing',
    'docs/reference/implementation/help-and-sharing.md': 'Help and sharing',
    'docs/reference/implementation/calendar-navigation.md': 'Calendar and navigation',
    'docs/reference/implementation/smart-dragging.md': 'Smart dragging and loading coverage',
    'docs/reference/implementation/on-demand-loading.md': 'On-demand server loading',
    'docs/reference/implementation/local-test-data.md': 'Local test datasets',
    'docs/sorting-filtering/implementation-status.md': 'Sorting, filtering and descriptors',
    'docs/sorting-filtering/legacy-preferences.md': 'Read-only source preferences',
    'docs/sorting-filtering/regex-qualification.md': 'Safe regular expressions',
  };
  const documents = {};
  for (const [file, title] of Object.entries(names)) documents[file] = { title, markdown: await read(file) };
  const manualImages = [];
  for (const [file, title] of [
    ['docs/ui/legacy-target/toolbar.png', 'Expected legacy toolbar'],
    ['docs/ui/legacy-target/view-modes.png', 'Required main-toolbar Timeline, Table and Split controls'],
    ['docs/ui/legacy-target/timeline.png', 'Expected two-source timeline'],
    ['docs/ui/legacy-target/sort-status.png', 'Legacy grouping by status'],
    ['docs/ui/legacy-target/sort-namespace.png', 'Legacy grouping by namespace'],
    ['docs/ui/legacy-target/sort-status-detail.png', 'Additional status grouping reference'],
    ['docs/ui/legacy-target/sort-earthquake-magtype.png', 'Earthquake grouping by magnitude type'],
  ]) {
    const data = await readFile(path.join(root, file));
    inputs[file] = createHash('sha256').update(data).digest('hex');
    manualImages.push({ title, dataUrl: `data:image/png;base64,${data.toString('base64')}` });
  }
  documents['docs/openbexi_timeline2.0_user_manual.md'].images = manualImages;
  const metadata = JSON.parse(await read('package.json'));
  const spec = JSON.parse(await read('shared/openapi.json'));
  const swagger = { js: await read('node_modules/swagger-ui-dist/swagger-ui-bundle.js'), css: await read('node_modules/swagger-ui-dist/swagger-ui.css') };
  return { inputs, document: { version: metadata.version, projectUrl: 'https://github.com/arcazj/openbexi_timeline2.0', documents, spec, swagger } };
}
