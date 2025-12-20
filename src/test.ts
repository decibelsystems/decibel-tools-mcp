#!/usr/bin/env node

/**
 * Test script to verify all Decibel tools work correctly.
 * Run with: npm test
 */

import { recordDesignDecision } from './tools/designer.js';
import { recordArchDecision } from './tools/architect.js';
import { createIssue } from './tools/sentinel.js';
import { nextActions } from './tools/oracle.js';

const PROJECT_ID = 'test-project';

async function testDesigner() {
  console.log('\n=== Testing Designer ===');

  const result = await recordDesignDecision({
    project_id: PROJECT_ID,
    area: 'API',
    summary: 'Use REST for public API endpoints',
    details: 'We decided to use REST instead of GraphQL for the public API because:\n1. Simpler learning curve for API consumers\n2. Better caching support\n3. More predictable rate limiting',
  });

  console.log('Designer result:', JSON.stringify(result, null, 2));
  return result;
}

async function testArchitect() {
  console.log('\n=== Testing Architect ===');

  const result = await recordArchDecision({
    projectId: PROJECT_ID,
    change: 'Migrate from monolith to microservices',
    rationale: 'The current monolithic architecture is becoming hard to scale and deploy independently. Microservices will allow teams to deploy features independently and scale specific services based on demand.',
    impact: 'This will require significant refactoring over the next few sprints. Team will need to set up container orchestration (K8s) and service mesh (Istio).',
  });

  console.log('Architect result:', JSON.stringify(result, null, 2));
  return result;
}

async function testSentinel() {
  console.log('\n=== Testing Sentinel ===');

  const result = await createIssue({
    projectId: PROJECT_ID,
    severity: 'high',
    title: 'Memory leak in auth service',
    details: 'The auth service shows increasing memory usage over time. After ~24 hours of uptime, memory usage grows from 256MB to 2GB. Suspected cause is unclosed database connections in the session handler.',
  });

  console.log('Sentinel result:', JSON.stringify(result, null, 2));
  return result;
}

async function testOracle() {
  console.log('\n=== Testing Oracle ===');

  // First without focus
  const result1 = await nextActions({
    project_id: PROJECT_ID,
  });

  console.log('Oracle result (no focus):', JSON.stringify(result1, null, 2));

  // Then with focus
  const result2 = await nextActions({
    project_id: PROJECT_ID,
    focus: 'sentinel',
  });

  console.log('Oracle result (focus: sentinel):', JSON.stringify(result2, null, 2));

  return result1;
}

async function runAllTests() {
  console.log('Starting Decibel Tools tests...');
  console.log('================================');

  try {
    await testDesigner();
    await testArchitect();
    await testSentinel();
    await testOracle();

    console.log('\n================================');
    console.log('All tests completed successfully!');
    console.log('================================\n');
  } catch (error) {
    console.error('\nTest failed:', error);
    process.exit(1);
  }
}

runAllTests();
