#!/usr/bin/env node
/**
 * Script to ensure all required KV namespaces exist
 * Run this before deployment if KV namespaces are missing
 * 
 * Usage: node scripts/ensure-kv-namespaces.js
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const KV_NAMESPACES = [
  { name: 'STATIC_ASSETS', binding: 'STATIC_ASSETS' },
  { name: 'CHAT_SYNC', binding: 'CHAT_SYNC' },
  { name: 'PUSH_RETRY', binding: 'PUSH_RETRY' },
];

function runCommand(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    return error.stdout || error.stderr || error.message;
  }
}

function getWranglerConfig() {
  try {
    const content = readFileSync('wrangler.jsonc', 'utf-8');
    // Simple JSONC parsing (remove comments)
    const cleaned = content
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function listKVNamespaces() {
  const output = runCommand('npx wrangler kv:namespace:list 2>&1');
  const namespaces = [];
  
  // Parse output like "name (id)" or just list format
  const lines = output.split('\n').filter(line => line.trim());
  for (const line of lines) {
    const match = line.match(/(\w+)\s+\(([a-f0-9-]+)\)/i);
    if (match) {
      namespaces.push({ title: match[1], id: match[2] });
    }
  }
  
  return namespaces;
}

function createKVNamespace(title) {
  console.log(`  Creating KV namespace: ${title}`);
  const output = runCommand(`npx wrangler kv:namespace:create ${title} 2>&1`);
  
  // Extract the ID from output
  const match = output.match(/id\s*=\s*"([a-f0-9-]+)"/);
  if (match) {
    return match[1];
  }
  
  // Try to parse as JSON
  try {
    const data = JSON.parse(output);
    return data.id;
  } catch {
    return null;
  }
}

function updateWranglerConfig(binding, id) {
  try {
    const content = readFileSync('wrangler.jsonc', 'utf-8');
    
    // Check if binding already exists
    if (content.includes(`"${binding}"`)) {
      console.log(`  ${binding} already exists in wrangler.jsonc`);
      return false;
    }
    
    // Find kv_namespaces array and add the new binding
    const kvMatch = content.match(/(kv_namespaces\s*:\s*\[)([\s\S]*?)(\])/);
    if (kvMatch) {
      const insertLine = `\n      { "binding": "${binding}", "id": "${id}" },`;
      const newContent = content.replace(
        /(kv_namespaces\s*:\s*\[)([\s\S]*?)(\])/,
        (match, open, existing, close) => {
          if (existing.trim() === '') {
            return `${open}${insertLine}\n    ${close}`;
          } else {
            return `${open}${existing}${insertLine}${close}`;
          }
        }
      );
      writeFileSync('wrangler.jsonc', newContent);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`  Failed to update wrangler.jsonc: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('\n🔍 Checking KV namespaces...\n');
  
  const config = getWranglerConfig();
  if (!config) {
    console.error('❌ Could not read wrangler.jsonc');
    process.exit(1);
  }
  
  // Get current bindings (check both top-level and env.production)
  const topBindings = config.kv_namespaces || [];
  const envBindings = config.env?.production?.kv_namespaces || [];
  const allBindings = [...topBindings, ...envBindings];
  const existingIds = new Map(allBindings.map(b => [b.binding, b.id]));
  
  console.log('Current production bindings:');
  if (existingIds.size === 0) {
    console.log('  (none configured)');
  } else {
    for (const [binding, id] of existingIds) {
      console.log(`  ${binding}: ${id}`);
    }
  }
  console.log('');
  
  // List all existing namespaces from Cloudflare
  console.log('Fetching existing KV namespaces from Cloudflare...');
  const existingNamespaces = listKVNamespaces();
  const existingByTitle = new Map(existingNamespaces.map(n => [n.title, n.id]));
  
  console.log(`Found ${existingNamespaces.length} existing KV namespaces\n`);
  
  // Check each required namespace
  const missingNamespaces = [];
  const updates = [];
  
  for (const { name, binding } of KV_NAMESPACES) {
    if (existingIds.has(binding)) {
      console.log(`✅ ${binding} is configured`);
    } else if (existingByTitle.has(name)) {
      console.log(`⚠️  ${name} exists but not bound in wrangler.jsonc`);
      updates.push({ binding, id: existingByTitle.get(name), action: 'bind' });
    } else {
      console.log(`❌ ${name} does not exist, will create`);
      missingNamespaces.push({ name, binding });
    }
  }
  
  console.log('');
  
  // Create missing namespaces
  if (missingNamespaces.length > 0) {
    console.log('Creating missing KV namespaces...\n');
    for (const { name, binding } of missingNamespaces) {
      const id = createKVNamespace(name);
      if (id) {
        console.log(`  ✅ Created ${name} with ID: ${id}`);
        updates.push({ binding, id, action: 'create' });
      } else {
        console.error(`  ❌ Failed to create ${name}`);
      }
    }
    console.log('');
  }
  
  // Update wrangler.jsonc automatically
  if (updates.length > 0) {
    console.log('📝 Updating wrangler.jsonc...');
    let updatedCount = 0;
    for (const update of updates) {
      if (updateWranglerConfig(update.binding, update.id)) {
        console.log(`  ✅ Added ${update.binding} to wrangler.jsonc`);
        updatedCount++;
      }
    }
    
    if (updatedCount > 0) {
      console.log('\n✅ wrangler.jsonc updated automatically!');
      console.log('   You can now run: npm run deploy\n');
    }
  } else if (missingNamespaces.length === 0) {
    console.log('✅ All KV namespaces are configured!\n');
  }
  
  console.log('Done!\n');
}

main().catch(console.error);
