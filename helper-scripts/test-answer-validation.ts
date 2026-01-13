#!/usr/bin/env node

/**
 * Test script for answer validation
 * Usage: npm run test-answer <question_id> <answer>
 * Example: npm run test-answer 123 "foreman"
 */

import * as sql from 'mssql';
import dotenv from 'dotenv';
import { validateAnswer } from '../src/services/answer-validator';

dotenv.config();

let pool: sql.ConnectionPool | null = null;

async function connect(): Promise<void> {
  if (pool) {
    return;
  }

  const config: sql.config = {
    user: process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
    server: process.env.MSSQL_SERVER || 'localhost',
    database: process.env.MSSQL_DATABASE || 'triviacreep',
    port: parseInt(process.env.MSSQL_PORT || '1433', 10),
    options: {
      encrypt: true,
      trustServerCertificate: true,
      enableArithAbort: true
    }
  };

  try {
    pool = await sql.connect(config);
    console.log('Connected to MSSQL database');
  } catch (error) {
    console.error('Database connection error:', error);
    throw error;
  }
}

async function close(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
    console.log('Database connection closed');
  }
}

function getConnection(): sql.ConnectionPool {
  if (!pool) {
    throw new Error('Database not connected. Call connect() first.');
  }
  return pool;
}

async function getQuestionAndSpec(questionId: number): Promise<{ question: any; spec: any } | null> {
  const pool = getConnection();
  
  try {
    // Get question
    const questionResult = await pool
      .request()
      .input('question_id', sql.Int, questionId)
      .query(`
        SELECT [id], [question], [answer], [category]
        FROM [dbo].[questions]
        WHERE [id] = @question_id
      `);

    if (questionResult.recordset.length === 0) {
      console.error(`Question with id ${questionId} not found`);
      return null;
    }

    const question = questionResult.recordset[0];

    // Get spec
    const specResult = await pool
      .request()
      .input('question_id', sql.Int, questionId)
      .query(`
        SELECT [spec_json]
        FROM [dbo].[question_answer_specs]
        WHERE [question_id] = @question_id
      `);

    if (specResult.recordset.length === 0) {
      console.error(`No spec found for question_id ${questionId}`);
      return null;
    }

    const spec = JSON.parse(specResult.recordset[0].spec_json);

    return { question, spec };
  } catch (error) {
    console.error('Error getting question and spec:', error);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: npm run test-answer <question_id> <answer>');
    console.error('Example: npm run test-answer 123 "foreman"');
    process.exit(1);
  }

  const questionId = parseInt(args[0], 10);
  const playerAnswer = args.slice(1).join(' '); // Join remaining args in case answer has spaces

  if (isNaN(questionId)) {
    console.error(`Invalid question_id: ${args[0]}`);
    process.exit(1);
  }

  try {
    await connect();

    const result = await getQuestionAndSpec(questionId);
    if (!result) {
      process.exit(1);
    }

    const { question, spec } = result;

    console.log('\n=== Question Information ===');
    console.log(`Question ID: ${question.id}`);
    console.log(`Question: ${question.question}`);
    console.log(`Answer: ${question.answer}`);
    console.log(`Category: ${question.category || 'N/A'}`);

    console.log('\n=== Spec Information ===');
    console.log(`Answer Mode: ${spec.answer_mode}`);
    if (spec.answer_mode === 'single') {
      console.log(`Accepted Array Length: ${spec.accepted?.length || 0}`);
      console.log(`Accepted Values: ${JSON.stringify(spec.accepted)}`);
    } else if (spec.answer_mode === 'n_of_m') {
      console.log(`Required Count: ${spec.required_count}`);
      console.log(`Options: ${JSON.stringify(spec.options)}`);
      console.log(`Option Aliases: ${JSON.stringify(spec.option_aliases)}`);
    }
    console.log(`Entity Type: ${spec.entity_type}`);

    console.log('\n=== Validation Test ===');
    console.log(`Player Answer: "${playerAnswer}"`);

    // Use the exact same validation function
    const isValid = validateAnswer(playerAnswer, question.answer, spec);

    console.log(`\nResult: ${isValid ? '✅ TRUE (ACCEPTED)' : '❌ FALSE (REJECTED)'}`);

    // Exit with code 0 for true, 1 for false (for scripting)
    process.exit(isValid ? 0 : 1);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await close();
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
