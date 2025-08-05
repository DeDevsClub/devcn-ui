#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { get } from 'node:https';
import { join, extname } from 'node:path';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Handle help and version flags
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    showVersion();
    process.exit(0);
  }

  // Handle commands
  if (command === 'list' || command === 'ls') {
    await listComponents();
    process.exit(0);
  } else if (command === 'add') {
    if (args.length < 2) {
      console.log('Usage: npx devcn-ui add [...packages]');
      process.exit(1);
    }

    const packageNames = args.slice(1);

    for (const packageName of packageNames) {
      if (!packageName.trim()) {
        continue;
      }

      console.log(`Adding ${packageName} component...`);
      await addComponentWithDependencies(packageName);
    }
  } else {
    console.log('Usage: npx devcn-ui <command> [options]');
    console.log('');
    console.log('Commands:');
    console.log('  add [...packages]  Add components to your project');
    console.log('  list, ls           List all available components');
    console.log('');
    console.log('Options:');
    console.log('  --help, -h         Show help information');
    console.log('  --version, -v      Show version information');
    process.exit(1);
  }
}

async function addComponentWithDependencies(packageName: string) {
  try {
    // Fetch component JSON to analyze dependencies
    const url = new URL(
      `r/${packageName}.json`,
      'https://devcn-ui.dedevs.com/'
    );
    
    const componentData = await fetchJson(url.toString());
    
    // Extract dependencies from component files
    const dependencies = extractDependencies(componentData);
    
    // Check and install missing dependencies
    if (dependencies.length > 0) {
      await installMissingDependencies(dependencies);
    }
    
    // Install the component using shadcn
    execSync(`npx shadcn@latest add ${url.toString()}`, { stdio: 'inherit' });
    
    // Transform imports in the generated component files
    await transformComponentImports(packageName);
    
    // Check and install missing shadcn/ui components
    await installMissingShadcnComponents(componentData);
    
  } catch (error) {
    console.error(`Failed to add ${packageName}:`, error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function extractDependencies(componentData: any): string[] {
  const dependencies = new Set<string>();
  
  if (!componentData.files || !Array.isArray(componentData.files)) {
    return [];
  }
  
  for (const file of componentData.files) {
    if (file.content) {
      // Extract import statements
      const importRegex = /import\s+(?:{[^}]*}|[^\s,]+|\*\s+as\s+\w+)\s+from\s+['"]([^'"]+)['"]/g;
      let match;
      
      while ((match = importRegex.exec(file.content)) !== null) {
        const importPath = match[1];
        
        // Skip relative imports and built-in modules
        if (importPath.startsWith('.') || importPath.startsWith('node:')) {
          continue;
        }
        
        // Handle scoped packages and regular packages
        const packageName = importPath.startsWith('@') 
          ? importPath.split('/').slice(0, 2).join('/')
          : importPath.split('/')[0];
          
        // Skip React, Next.js, and workspace packages
        if (['react', 'react-dom', 'next'].includes(packageName) || packageName.startsWith('@repo/')) {
          continue;
        }
        
        // Map known workspace dependencies to their public equivalents
        const mappedDependency = mapWorkspaceDependency(packageName, importPath);
        if (mappedDependency) {
          dependencies.add(mappedDependency);
        } else {
          dependencies.add(packageName);
        }
      }
    }
  }
  
  return Array.from(dependencies);
}

function mapWorkspaceDependency(packageName: string, importPath: string): string | null {
  // Handle @repo/shadcn-ui imports - these don't need external dependencies
  // as they're typically just re-exports of standard shadcn/ui components
  if (packageName === '@repo/shadcn-ui') {
    return null; // shadcn/ui components are installed via shadcn CLI, not npm
  }
  
  // Handle @repo/code-block - map to its actual dependencies
  if (packageName === '@repo/code-block') {
    // Return the actual dependencies that code-block needs
    return 'shiki'; // or whatever the actual dependency is
  }
  
  // Add more mappings as needed
  return null;
}

async function installMissingDependencies(dependencies: string[]) {
  const packageJsonPath = join(process.cwd(), 'package.json');
  
  if (!existsSync(packageJsonPath)) {
    console.log('⚠️  No package.json found. Skipping dependency check.');
    return;
  }
  
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const installedDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.peerDependencies
  };
  
  const missingDeps = dependencies.filter(dep => !installedDeps[dep]);
  
  if (missingDeps.length === 0) {
    return;
  }
  
  console.log(`📦 Installing missing dependencies: ${missingDeps.join(', ')}`);
  
  // Detect package manager
  const packageManager = detectPackageManager();
  
  try {
    const installCommand = `${packageManager} ${packageManager === 'npm' ? 'install' : 'add'} ${missingDeps.join(' ')}`;
    execSync(installCommand, { stdio: 'inherit' });
    console.log('✅ Dependencies installed successfully');
  } catch (error) {
    console.error('❌ Failed to install dependencies:', error instanceof Error ? error.message : String(error));
    console.log('Please install them manually:', missingDeps.join(', '));
  }
}

async function transformComponentImports(packageName: string) {
  const componentsDir = join(process.cwd(), 'components');
  
  if (!existsSync(componentsDir)) {
    return; // No components directory found
  }
  
  // Find component files that might have been created
  const componentFiles = findComponentFiles(componentsDir);
  
  for (const filePath of componentFiles) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const transformedContent = transformImports(content);
      
      if (content !== transformedContent) {
        writeFileSync(filePath, transformedContent, 'utf-8');
        console.log(`✨ Transformed imports in ${filePath.replace(process.cwd(), '.')}`);
      }
    } catch (error) {
      console.warn(`⚠️  Could not transform imports in ${filePath}:`, error instanceof Error ? error.message : String(error));
    }
  }
}

function findComponentFiles(dir: string): string[] {
  const files: string[] = [];
  
  try {
    const entries = readdirSync(dir);
    
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory()) {
        // Recursively search subdirectories
        files.push(...findComponentFiles(fullPath));
      } else if (stat.isFile() && ['.tsx', '.ts', '.jsx', '.js'].includes(extname(entry))) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    // Ignore errors reading directory
  }
  
  return files;
}

function transformImports(content: string): string {
  // Transform @repo/shadcn-ui imports to standard shadcn/ui imports
  let transformed = content.replace(
    /import\s+({[^}]*})\s+from\s+['"]@repo\/shadcn-ui\/components\/ui\/([^'"]+)['"]/g,
    "import $1 from '@/components/ui/$2'"
  );
  
  // Transform @repo/shadcn-ui/lib/utils imports
  transformed = transformed.replace(
    /import\s+({[^}]*})\s+from\s+['"]@repo\/shadcn-ui\/lib\/utils['"]/g,
    "import $1 from '@/lib/utils'"
  );
  
  // Transform @repo/code-block imports to direct component imports
  transformed = transformed.replace(
    /import\s+({[^}]*})\s+from\s+['"]@repo\/code-block['"]/g,
    "import $1 from '@/components/ui/code-block'"
  );
  
  // Transform other @repo/ imports by removing the @repo/ prefix
  transformed = transformed.replace(
    /import\s+([^\s]+)\s+from\s+['"]@repo\/([^'"]+)['"]/g,
    "import $1 from '$2'"
  );
  
  return transformed;
}

async function installMissingShadcnComponents(componentData: any) {
  if (!componentData.files || !Array.isArray(componentData.files)) {
    return;
  }
  
  const requiredShadcnComponents = new Set<string>();
  
  // Extract shadcn/ui component imports from the component files
  for (const file of componentData.files) {
    if (file.content) {
      // Look for @repo/shadcn-ui imports that will be transformed to @/components/ui/
      const shadcnImportRegex = /@repo\/shadcn-ui\/components\/ui\/([^'"]+)/g;
      let match;
      
      while ((match = shadcnImportRegex.exec(file.content)) !== null) {
        const componentName = match[1];
        requiredShadcnComponents.add(componentName);
      }
    }
  }
  
  if (requiredShadcnComponents.size === 0) {
    return;
  }
  
  // Check which components are missing
  const missingComponents = [];
  const componentsUiDir = join(process.cwd(), 'components', 'ui');
  
  for (const componentName of requiredShadcnComponents) {
    const componentPath = join(componentsUiDir, `${componentName}.tsx`);
    const altComponentPath = join(componentsUiDir, `${componentName}.ts`);
    
    if (!existsSync(componentPath) && !existsSync(altComponentPath)) {
      missingComponents.push(componentName);
    }
  }
  
  if (missingComponents.length === 0) {
    return;
  }
  
  console.log(`🧩 Installing missing shadcn/ui components: ${missingComponents.join(', ')}`);
  
  // Install missing shadcn/ui components
  for (const componentName of missingComponents) {
    try {
      console.log(`  Installing ${componentName}...`);
      execSync(`npx shadcn@latest add ${componentName}`, { stdio: 'pipe' });
      console.log(`  ✅ ${componentName} installed`);
    } catch (error) {
      console.warn(`  ⚠️  Could not install ${componentName}:`, error instanceof Error ? error.message : String(error));
      console.log(`  Please install it manually: npx shadcn@latest add ${componentName}`);
    }
  }
}

function detectPackageManager(): string {
  if (existsSync('pnpm-lock.yaml')) return 'pnpm';
  if (existsSync('yarn.lock')) return 'yarn';
  if (existsSync('package-lock.json')) return 'npm';
  return 'npm'; // default fallback
}

// Run main function
main().catch((error) => {
  console.error('An error occurred:', error.message);
  process.exit(1);
});

function showHelp() {
  console.log('Devcn UI CLI - Add components from the Devcn UI Design Registry');
  console.log('');
  console.log('Usage: npx devcn-ui <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  add [...packages]  Add components to your project');
  console.log('  list, ls           List all available components');
  console.log('');
  console.log('Options:');
  console.log('  --help, -h         Show help information');
  console.log('  --version, -v      Show version information');
  console.log('');
  console.log('Examples:');
  console.log('  npx devcn-ui add button');
  console.log('  npx devcn-ui add button card dialog');
  console.log('  npx devcn-ui list');
}

function showVersion() {
  // Read version from package.json
  try {
    const packageJson = require('../package.json');
    console.log(packageJson.version);
  } catch {
    console.log('0.0.3');
  }
}

async function listComponents() {
  try {
    console.log('Fetching available components...');
    
    let registry;
    try {
      // Try to fetch the registry from the public URL
      const registryUrl = 'https://devcn-ui.dedevs.com/registry.json';
      registry = await fetchJson(registryUrl);
    } catch (error) {
      // Fallback to hardcoded registry data
      console.log('Using local registry data...');
      registry = {
        items: [
          { name: 'ai-branch', description: 'AI conversation branch component for displaying branched conversations' },
          { name: 'ai-conversation', description: 'AI conversation container component' },
          { name: 'ai-input', description: 'AI chat input component with advanced features' },
          { name: 'ai-message', description: 'AI message display component' },
          { name: 'ai-reasoning', description: 'AI reasoning visualization component' },
          { name: 'ai-response', description: 'AI response component with streaming support' },
          { name: 'ai-server', description: 'AI server component utilities' },
          { name: 'ai-simple', description: 'Simple AI component for basic interactions' },
          { name: 'ai-source', description: 'AI source attribution component' },
          { name: 'ai-suggestion', description: 'AI suggestion component for prompts and recommendations' },
          { name: 'ai-tool', description: 'AI tool component for function calling interfaces' },
          { name: 'code-block', description: 'Enhanced code block component with syntax highlighting' },
          { name: 'editor', description: 'Code editor component' },
          { name: 'snippet', description: 'Code snippet component' }
        ]
      };
    }

    if (!registry.items || !Array.isArray(registry.items)) {
      throw new Error('Invalid registry format');
    }

    console.log('');
    console.log('Available components:');
    console.log('');

    // Group components by type
    const aiComponents = registry.items.filter((item: any) => item.name.startsWith('ai-'));
    const utilityComponents = registry.items.filter((item: any) => !item.name.startsWith('ai-'));

    if (aiComponents.length > 0) {
      console.log('🤖 AI Components:');
      aiComponents.forEach((item: any) => {
        const name = item.name.padEnd(15);
        console.log(`  ${name} ${item.description || 'No description available'}`);
      });
      console.log('');
    }

    if (utilityComponents.length > 0) {
      console.log('🛠️  Utility Components:');
      utilityComponents.forEach((item: any) => {
        const name = item.name.padEnd(15);
        console.log(`  ${name} ${item.description || 'No description available'}`);
      });
    }

    console.log('');
    console.log(`Total: ${registry.items.length} components available`);
    console.log('');
    console.log('Usage: npx devcn-ui add <component-name>');

  } catch (error) {
    console.error('Error fetching components:');
    console.error(error instanceof Error ? error.message : 'Unknown error');
    console.log('');
    console.log('Please check your internet connection and try again.');
    console.log('You can also visit https://devcn-ui.dedevs.com to browse components online.');
    process.exit(1);
  }
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch registry: ${res.statusCode}`));
        return;
      }
      
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (error) {
          reject(new Error('Failed to parse JSON response'));
        }
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}
