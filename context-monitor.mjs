#!/usr/bin/env node
/**
 * Context Monitor
 * 
 * Checks current context usage and triggers memory consolidation at 90k tokens
 * Run this via session_status tool or manually
 * 
 * Usage:
 *   node tools/context-monitor.mjs <current-tokens>
 */

import { execSync } from 'child_process';

const currentTokens = parseInt(process.argv[2]) || 0;
const threshold = 90000;

console.log(`Current context: ${currentTokens} tokens`);

if (currentTokens >= threshold) {
  console.log(`⚠️ Context at ${currentTokens} tokens (threshold: ${threshold})`);
  console.log('Triggering memory consolidation...');
  
  try {
    execSync('node tools/memory-consolidation.mjs --context-trigger', { 
      stdio: 'inherit',
      cwd: process.cwd()
    });
    console.log('✅ Memory consolidation complete');
    console.log('💡 Consider running /new to start fresh session');
  } catch (err) {
    console.error('❌ Consolidation failed:', err.message);
  }
} else {
  const remaining = threshold - currentTokens;
  const percentUsed = ((currentTokens / 200000) * 100).toFixed(1);
  console.log(`✅ Context healthy: ${remaining} tokens until consolidation (${percentUsed}% of max)`);
}
