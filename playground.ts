import { GatewayConfigLoader } from './dist/config-loader.js';
import { z } from 'zod';
import * as dotenv from 'dotenv';

// Initialize environment redirects from the .env file
dotenv.config();

// Define a strict validation schema to verify our structured output contracts
const TechnicalReviewSchema = z.object({
  architectureRating: z.number().min(1).max(10),
  detectedAntiPatterns: z.array(z.string()),
  recommendedRefactor: z.string(),
});

async function runLivePlayground() {
  console.log('═'.repeat(60));
  console.log('🚀 LIGHTWEIGHT DYNAMIC PLAYGROUND HARNESS');
  console.log('═'.repeat(60));

  try {
    // 1. Read and validate your custom agents.json directly from disk
    const loader = await GatewayConfigLoader.fromFile('./agents.json');
    console.log('✅ agents.json loaded and validated successfully via config engine.');

    // ────────────────────────────────────────────────────────────────
    // TEST CASE 1: Text Task via Gemini (using OpenAI base redirect)
    // ────────────────────────────────────────────────────────────────
    console.log('\n📡 Test 1: Running Text Task (Gemini via FreeLLMAPI)...');
    const textAgent = loader.get('text-transformer');
    
    const textResult = await textAgent.executeTextTask({
      code: "function optimizeQueries() { console.log('Deploying backend execution clients.'); }"
    });

    console.log('\n📄 Received Output Text:');
    console.log(`"${textResult.data}"`); 
    // -> Note how "optimize" is automatically translated to "optimise" via gateway compliance rules

    console.log('\n📊 Connection Telemetry Envelope:');
    console.log(JSON.stringify(textResult.telemetry, null, 2));

    // ────────────────────────────────────────────────────────────────
    // TEST CASE 2: Structured Task via Gemini
    // ────────────────────────────────────────────────────────────────
    console.log('\n📡 Test 2: Running Structured Task (Gemini via FreeLLMAPI)...');
    const structuredAgent = loader.get('json-extractor');

    const jsonResult = await structuredAgent.executeStructuredTask(
      "Evaluate this statement: 'We use global mutable array variables to handle concurrent session logs.'",
      TechnicalReviewSchema
    );

    console.log('\n🧩 Received Validated JSON Object (Natively Typed via Zod):');
    console.log(JSON.stringify(jsonResult.data, null, 2));
    console.log(`\nVerified native property: Rating is ${jsonResult.data.architectureRating}/10`);

    // ────────────────────────────────────────────────────────────────
    // TEST CASE 3: Simulating a Compliance Gate REJECT Trap
    // ────────────────────────────────────────────────────────────────
    console.log('\n📡 Test 3: Simulating a Compliance Gate REJECT Trap...');
    console.log('Force feeding an instruction that triggers a rule violation...');

    await textAgent.executeTextTask({
      code: "function reviewPipeline() { // Let's delve into the context loops }" // Triggers 'purge-buzzwords' gate
    });

  } catch (error: any) {
    if (error.errorCode) {
      console.log('\n🛑 Gateway Exception Intercepted Successfully!');
      console.log(`Code Slug:   [${error.errorCode}]`);
      console.log(`Message:     ${error.message}`);
    } else {
      console.error('\n💥 Unexpected System Failure:', error);
    }
  }
  console.log('\n' + '═'.repeat(60));
}

runLivePlayground();
