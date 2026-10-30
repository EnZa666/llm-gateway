/**
 * eval-harness.ts — Standalone evaluation script for FORGE LLM Gateway
 * Run with: npx tsx eval/eval-harness.ts
 * Not wired to Jest; run manually when switching providers.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { LLMGateway } from '../src/index.js';
import { ForgeGatewayError } from '../src/errors.js';
import { mockEvalSchema } from './fixtures/mock-schema.js';
import type { PhaseRuntimeConfig } from '../src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function loadFixture(name: string): Promise<string> {
  return readFile(join(__dirname, 'fixtures', name), 'utf-8');
}

const PROVIDER_CONFIGS: PhaseRuntimeConfig[] = [
  {
    phase_id: 'eval-anthropic',
    runtime_execution: {
      provider_package: '@ai-sdk/anthropic',
      provider_factory_method: 'anthropic',
      model_identifier: 'claude-3-5-haiku-20241022',
      settings: { temperature: 0, max_tokens: 500 },
    },
  },
  {
    phase_id: 'eval-openai',
    runtime_execution: {
      provider_package: '@ai-sdk/openai',
      provider_factory_method: 'openai',
      model_identifier: 'gpt-4o-mini',
      settings: { temperature: 0, max_tokens: 500 },
    },
  },
];

async function runDeterministicEval(systemRules: string, jdContent: string): Promise<void> {
  console.log('\n=== Deterministic Contract Eval ===');
  let passed = 0;
  for (const config of PROVIDER_CONFIGS) {
    const gw = new LLMGateway(config);
    try {
      const result = await gw.executeStructuredTask(
        systemRules,
        'Analyze the following job description and return a structured evaluation.',
        jdContent,
        mockEvalSchema,
      );
      console.log(
        `[PASS] ${config.phase_id}: score=${result.data.score}, keywords=${result.data.keywords.length}`,
      );
      passed++;
    } catch (err) {
      if (err instanceof ForgeGatewayError && err.errorCode === 'SCHEMA_VALIDATION_FAILED') {
        console.error(`[FAIL] ${config.phase_id}: SCHEMA_VALIDATION_FAILED — ${err.message}`);
      } else {
        throw err;
      }
    }
  }
  if (passed < PROVIDER_CONFIGS.length) {
    throw new Error(
      `Deterministic eval: ${PROVIDER_CONFIGS.length - passed} providers failed schema validation`,
    );
  }
  console.log(`Deterministic eval: ${passed}/${PROVIDER_CONFIGS.length} providers passed.\n`);
}

async function runSemanticEval(systemRules: string, jdContent: string): Promise<void> {
  console.log('=== Semantic LLM-as-Judge Eval ===');
  const complianceRules = [
    {
      ruleId: 'no-filler-start',
      type: 'REPLACE' as const,
      pattern: /^Sure[,!]?\s*/i,
      replacementValue: '',
    },
    {
      ruleId: 'no-speculation',
      type: 'REJECT' as const,
      pattern: /I think|I believe|I suppose/gi,
      customErrorMessage: 'Speculative language detected',
    },
  ];

  const subjectConfig = PROVIDER_CONFIGS[0];
  if (!subjectConfig) throw new Error('No provider configs defined');
  const subjectGw = new LLMGateway(subjectConfig);
  const subjectResult = await subjectGw.executeTextTask(
    systemRules,
    'Summarize the key requirements from the following job description in two sentences.',
    jdContent,
    complianceRules,
  );
  console.log(`Subject output: "${subjectResult.data.slice(0, 120)}..."`);

  // LLM-as-judge: use second provider to verify constraint adherence
  const judgeConfig = PROVIDER_CONFIGS[1];
  if (!judgeConfig) throw new Error('No judge provider config defined');
  const judgeGw = new LLMGateway(judgeConfig);
  const judgeSchema = z.object({
    adherent: z.boolean(),
    reason: z.string(),
  });
  const judgeResult = await judgeGw.executeStructuredTask(
    'You are a strict compliance judge. Respond only with a JSON object.',
    `Does this text follow the given rules?\n\nRules:\n${systemRules}\n\nText:\n${subjectResult.data}`,
    '',
    judgeSchema,
  );
  if (!judgeResult.data.adherent) {
    console.error(
      `[FAIL] Semantic eval: judge flagged non-adherence — ${judgeResult.data.reason}`,
    );
    process.exit(1);
  }
  console.log(`[PASS] Semantic eval: judge confirmed adherence — ${judgeResult.data.reason}\n`);
}

async function main(): Promise<void> {
  console.log('FORGE LLM Gateway — Eval Harness');
  console.log('================================\n');

  const [systemRules, jdContent] = await Promise.all([
    loadFixture('mock-rules.md'),
    loadFixture('mock-jd.md'),
  ]);

  await runDeterministicEval(systemRules, jdContent);
  await runSemanticEval(systemRules, jdContent);

  console.log('All evals passed.');
}

main().catch((err) => {
  console.error('Eval harness failed:', err);
  process.exit(1);
});
