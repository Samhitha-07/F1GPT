import OpenAI from "openai";
import { streamText } from "ai"; // updated import
import { DataAPIClient } from "@datastax/astra-db-ts";

const {
  ASTRA_DB_NAMESPACE,
  ASTRA_DB_COLLECTION,
  ASTRA_DB_API_ENDPOINT,
  ASTRA_DB_APPLICATION_TOKEN,
  OPENAI_API_KEY,
} = process.env;

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY!,
});

const client = new DataAPIClient(ASTRA_DB_APPLICATION_TOKEN!);

const db = client.db(ASTRA_DB_API_ENDPOINT!, {
  namespace: ASTRA_DB_NAMESPACE!,
});

// Retry logic for OpenAI API call in case of quota issues
async function retryOpenAIRequest(latestMessage: string, retries = 3, delay = 5000) {
  try {
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: latestMessage,
      encoding_format: "float",
    });

    return embeddingResponse.data[0].embedding;
  } catch (error) {
    if (error.code === 'insufficient_quota' && retries > 0) {
      console.log("Quota exceeded. Retrying after a delay...");
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryOpenAIRequest(latestMessage, retries - 1, delay * 2); // Exponential backoff
    }
    throw error; // Re-throw if it’s not a quota issue or retries are exhausted
  }
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();
    const latestMessage = messages[messages.length - 1]?.content;

    let docContext = "";

    // Get embeddings with retry logic
    const embedding = await retryOpenAIRequest(latestMessage);

    try {
      const collection = await db.collection(ASTRA_DB_COLLECTION!);
      const cursor = collection.find({ $vector: embedding }, { limit: 10 });
      const documents = await cursor.toArray();
      const docsMap = documents?.map((doc) => doc.text);
      docContext = docsMap.join("\n\n");
    } catch (error) {
      console.error("Error fetching from Astra DB:", error);
    }

    const template = {
      role: "system",
      content: `You are an AI assistant who knows everything about Formula One.
Use the below context to augment what you know...
------ START CONTEXT ------
${docContext}
------ END CONTEXT ------
QUESTION: ${latestMessage}`,
    };

    const result = await streamText({
      model: openai.chat,
      messages: [template, ...messages],
    });

    return result.toDataStreamResponse(); // new method instead of StreamingTextResponse
  } catch (error) {
    console.error("Server error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
