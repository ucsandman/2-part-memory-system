#!/usr/bin/env node
/**
 * Memory Consolidation System
 * 
 * Runs nightly (2 AM) or when context reaches 90k tokens
 * 
 * Purpose:
 * - Extract decisions, lessons, insights from daily logs
 * - Update MEMORY.md index
 * - Create/update detail files (people, projects, decisions)
 * - Log to DashClaw (handoff, key points)
 * 
 * Usage:
 *   node tools/memory-consolidation.mjs [--context-trigger]
 */

import { DashClaw } from 'dashclaw';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// Load DashClaw
const envContent = readFileSync('secrets/dashclaw.env', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const m = line.match(/^([^#][^=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
});

const claw = new DashClaw({
  baseUrl: env.DASHCLAW_BASE_URL,
  apiKey: env.DASHCLAW_API_KEY,
  agentId: 'moltfire',
  agentName: 'MoltFire'
});

const isContextTrigger = process.argv.includes('--context-trigger');
const mode = isContextTrigger ? 'CONTEXT_TRIGGER' : 'NIGHTLY';

console.log(`[${mode}] Starting memory consolidation...`);

// Get today's date
const today = new Date();
const yyyy = today.getFullYear();
const mm = String(today.getMonth() + 1).padStart(2, '0');
const dd = String(today.getDate()).padStart(2, '0');
const dateStr = `${yyyy}-${mm}-${dd}`;

// Read today's daily log
const dailyLogPath = `memory/${dateStr}.md`;
if (!existsSync(dailyLogPath)) {
  console.log(`No daily log found for ${dateStr}, skipping consolidation.`);
  process.exit(0);
}

const dailyLog = readFileSync(dailyLogPath, 'utf8');

// Extract sections using markdown headers
const sections = {};
let currentSection = 'intro';
let currentContent = [];

dailyLog.split('\n').forEach(line => {
  if (line.match(/^###\s+(.+)/)) {
    if (currentContent.length > 0) {
      sections[currentSection] = currentContent.join('\n');
    }
    currentSection = line.match(/^###\s+(.+)/)[1].trim();
    currentContent = [];
  } else {
    currentContent.push(line);
  }
});
if (currentContent.length > 0) {
  sections[currentSection] = currentContent.join('\n');
}

console.log(`Found ${Object.keys(sections).length} sections in daily log`);

// Extract decisions (look for "Decision:" or "Decided:")
const decisions = [];
Object.entries(sections).forEach(([section, content]) => {
  const lines = content.split('\n');
  lines.forEach(line => {
    if (line.match(/^\*\*Decision:|Decided:|Decision made:/i)) {
      decisions.push({
        section,
        text: line.replace(/^\*\*Decision:|Decided:|Decision made:/i, '').trim()
      });
    }
  });
});

// Extract lessons (look for "Lesson:" or "Learned:")
const lessons = [];
Object.entries(sections).forEach(([section, content]) => {
  const lines = content.split('\n');
  lines.forEach(line => {
    if (line.match(/^\*\*Lesson:|Learned:|Discovery:/i)) {
      lessons.push({
        section,
        text: line.replace(/^\*\*Lesson:|Learned:|Discovery:/i, '').trim()
      });
    }
  });
});

// Extract key insights (look for **Key** or breakthrough)
const insights = [];
Object.entries(sections).forEach(([section, content]) => {
  if (content.match(/breakthrough|insight|realized|discovered/i)) {
    const match = content.match(/(.{0,200}(breakthrough|insight|realized|discovered).{0,200})/i);
    if (match) {
      insights.push({
        section,
        text: match[1].trim()
      });
    }
  }
});

console.log(`Extracted: ${decisions.length} decisions, ${lessons.length} lessons, ${insights.length} insights`);

// Prepare consolidation summary
const summary = {
  date: dateStr,
  mode,
  decisions: decisions.map(d => d.text),
  lessons: lessons.map(l => l.text),
  insights: insights.map(i => i.text),
  sections: Object.keys(sections)
};

// Create handoff in DashClaw
const handoffData = {
  summary: `Memory consolidation for ${dateStr} (${mode})`,
  session_date: dateStr,
  key_decisions: decisions.map(d => d.text).slice(0, 10),
  open_tasks: [], // Could extract TODO items
  next_priorities: []
};

console.log('Creating DashClaw handoff...');
const handoff = await claw.createHandoff(handoffData);
console.log(`Handoff created: ${handoff.handoff_id}`);

// Capture key points in DashClaw
if (insights.length > 0) {
  console.log('Capturing key insights...');
  for (const insight of insights.slice(0, 5)) {
    await claw.captureKeyPoint({
      content: `[${insight.section}] ${insight.text}`,
      category: 'insight',
      importance: 7,
      session_date: dateStr
    });
  }
}

// Record decisions in DashClaw
if (decisions.length > 0) {
  console.log('Recording decisions...');
  for (const decision of decisions.slice(0, 5)) {
    await claw.recordDecision({
      decision: decision.text,
      context: `From daily log section: ${decision.section}`,
      outcome: 'success',
      confidence: 80
    });
  }
}

// Write consolidation log
const consolidationLogPath = `memory/consolidations/${dateStr}.json`;
writeFileSync(consolidationLogPath, JSON.stringify(summary, null, 2));
console.log(`Consolidation log saved: ${consolidationLogPath}`);

// Update last consolidation timestamp
const stateFile = 'memory/consolidation-state.json';
const state = existsSync(stateFile) 
  ? JSON.parse(readFileSync(stateFile, 'utf8'))
  : {};

state.lastConsolidation = new Date().toISOString();
state.lastDate = dateStr;
state.mode = mode;
state.decisionsExtracted = decisions.length;
state.lessonsExtracted = lessons.length;
state.insightsExtracted = insights.length;

writeFileSync(stateFile, JSON.stringify(state, null, 2));

console.log('\n=== Consolidation Complete ===');
console.log(`Decisions: ${decisions.length}`);
console.log(`Lessons: ${lessons.length}`);
console.log(`Insights: ${insights.length}`);
console.log(`Handoff: ${handoff.handoff_id}`);
console.log(`Mode: ${mode}`);
