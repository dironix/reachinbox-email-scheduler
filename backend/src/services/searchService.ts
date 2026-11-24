import { esClient, EMAILS_INDEX } from '../config/elasticsearch';

export interface EmailSearchDoc {
  id: string;
  userId: string;
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: Date;
  sentAt?: Date | null;
}

export async function indexEmailDocument(doc: EmailSearchDoc): Promise<void> {
  try {
    await esClient.index({
      index: EMAILS_INDEX,
      id: doc.id,
      document: doc,
      refresh: true,
    });
  } catch (error) {
    console.error(`❌ Failed to index email ${doc.id} in Elasticsearch:`, error);
  }
}

export async function searchEmailsInES(userId: string, query: string, status?: string) {
  const mustClauses: any[] = [{ term: { userId } }];

  if (status) {
    mustClauses.push({ term: { status } });
  }

  if (query.trim()) {
    mustClauses.push({
      multi_match: {
        query,
        fields: ['recipientEmail^2', 'subject^2', 'body'],
        fuzziness: 'AUTO',
      },
    });
  }

  const result = await esClient.search({
    index: EMAILS_INDEX,
    size: 100,
    sort: [{ scheduledAt: { order: 'desc' } }],
    query: {
      bool: {
        must: mustClauses,
      },
    },
  });

  return result.hits.hits.map((hit: any) => hit._source);
}