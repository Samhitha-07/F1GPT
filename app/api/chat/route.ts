import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { DataAPIClient } from '@datastax/astra-db-ts';
import 'dotenv/config';

const {
  ASTRA_DB_NAMESPACE,
  ASTRA_DB_COLLECTION,
  ASTRA_DB_API_ENDPOINT,
  ASTRA_DB_APPLICATION_TOKEN,
  OPENAI_API_KEY,
} = process.env;

const client = new DataAPIClient(ASTRA_DB_APPLICATION_TOKEN!);
const db = client.db(ASTRA_DB_API_ENDPOINT!, {
  namespace: ASTRA_DB_NAMESPACE!,
});

// Retry logic for OpenAI embedding request
async function retryOpenAIRequest(latestMessage: string, retries = 3, delay = 5000): Promise<number[]> {
  const OpenAI = (await import('openai')).default;
  const openaiInstance = new OpenAI({ apiKey: OPENAI_API_KEY! });

  try {
    const embeddingResponse = await openaiInstance.embeddings.create({
      model: 'text-embedding-3-small',
      input: latestMessage,
      encoding_format: 'float',
    });

    return embeddingResponse.data[0].embedding;
  } catch (error: any) {
    if (error.code === 'insufficient_quota' && retries > 0) {
      console.warn("Quota exceeded. Retrying after delay...");
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryOpenAIRequest(latestMessage, retries - 1, delay * 2);
    }
    throw error;
  }
}

export async function POST(req: Request): Promise<Response> {
  const { messages } = await req.json();
  const latestMessage = messages[messages.length - 1]?.content;
  let docContext = '';

  try {
    const embedding = await retryOpenAIRequest(latestMessage);

    try {
      const collection = await db.collection(ASTRA_DB_COLLECTION!);
      const cursor = collection.find({ $vector: embedding }, { limit: 10 });
      const documents = await cursor.toArray();
      const docsMap = documents?.map(doc => doc.text);
      docContext = docsMap.join('\n\n');
    } catch (error) {
      console.error("Error fetching from Astra DB:", error);
    }

    const systemMessage = {
      role: 'system' as const,
      content: `You are an AI assistant who knows everything about Formula One.
Use the below context to augment what you know:
------ START CONTEXT ------
${docContext}
------ END CONTEXT ------
QUESTION: ${latestMessage}`,
    };

    const result = await streamText({
      model: openai.chat('gpt-4'),
      messages: [systemMessage, ...messages],
    });

    return new Response(result.textStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });

  } catch (error) {
    console.error('Error in POST handler:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
