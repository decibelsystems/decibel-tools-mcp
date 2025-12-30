#!/usr/bin/env npx ts-node
/**
 * Experiment: DOJO-EXP-0001
 * Proposal: DOJO-PROP-0001
 * Title: Voice Input for Decibel Commands
 *
 * This experiment validates the voice input architecture:
 * - Voice Inbox for queued transcripts
 * - Intent parsing from natural language
 * - Routing to existing MCP tools
 */

// Use absolute path since we're in .decibel/dojo/experiments
import { parseIntent } from '../../../../src/tools/voice.js';

// Test cases for intent parsing
const testCases = [
  // Wish patterns
  { input: 'add a wish for better error messages', expected: 'add_wish' },
  { input: 'wish: I want autocomplete in the CLI', expected: 'add_wish' },
  { input: 'I wish we had dark mode', expected: 'add_wish' },

  // Issue patterns
  { input: 'log an issue about the login button', expected: 'log_issue' },
  { input: 'there is a bug with the search', expected: 'log_issue' },
  { input: 'issue: sidebar overlaps content', expected: 'log_issue' },

  // Search patterns
  { input: 'find all issues about authentication', expected: 'search' },
  { input: 'what is the caching strategy?', expected: 'search' },
  { input: 'where is the error handler?', expected: 'search' },

  // Oracle patterns
  { input: "what's the roadmap status", expected: 'ask_oracle' },
  { input: 'how are we doing on progress', expected: 'ask_oracle' },
  { input: 'project status please', expected: 'ask_oracle' },

  // Crit patterns
  { input: 'crit: the button feels too small', expected: 'log_crit' },
  { input: 'I noticed the colors are inconsistent', expected: 'log_crit' },

  // Friction patterns
  { input: 'friction: deployments take too long', expected: 'log_friction' },
  { input: 'it is frustrating that tests are slow', expected: 'log_friction' },

  // Learning patterns
  { input: 'learned: always check null before formatting', expected: 'record_learning' },
  { input: 'I just discovered you can batch API calls', expected: 'record_learning' },
];

async function main() {
  console.log('Running experiment DOJO-EXP-0001: Voice Intent Parsing\n');

  let passed = 0;
  let failed = 0;

  for (const test of testCases) {
    const result = parseIntent(test.input);
    const success = result.intent === test.expected;

    if (success) {
      passed++;
      console.log(`✓ "${test.input.slice(0, 40)}..." → ${result.intent} (${(result.confidence * 100).toFixed(0)}%)`);
    } else {
      failed++;
      console.log(`✗ "${test.input.slice(0, 40)}..." → ${result.intent} (expected: ${test.expected})`);
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${testCases.length} total`);
  console.log(`Success rate: ${((passed / testCases.length) * 100).toFixed(1)}%`);

  // Exit with error if any failures
  if (failed > 0) {
    process.exit(1);
  }

  console.log('\nExperiment complete. Voice intent parsing validated.');
}

main().catch(console.error);
