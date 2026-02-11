/**
 * Microsoft Graph mail operations.
 *
 * Wraps the Graph REST API for listing, reading, searching, sending,
 * and exporting emails. Uses raw fetch — the Graph API is simple enough
 * that the SDK would just add weight.
 */

import { getAccessToken } from "./auth";
import * as fs from "fs";
import * as path from "path";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

interface GraphRequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Make an authenticated request to the Graph API. */
async function graphFetch(
  endpoint: string,
  options: GraphRequestOptions = {}
): Promise<Response> {
  const token = await getAccessToken();
  const { method = "GET", body, headers = {} } = options;

  const response = await fetch(`${GRAPH_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Graph API ${method} ${endpoint} failed (${response.status}): ${errorBody}`
    );
  }

  return response;
}

/** Make a Graph API request and parse JSON response. */
async function graphJson<T = unknown>(
  endpoint: string,
  options: GraphRequestOptions = {}
): Promise<T> {
  const response = await graphFetch(endpoint, options);
  return response.json() as Promise<T>;
}

// ─── Types ──────────────────────────────────────────────────────────

export interface MailMessage {
  id: string;
  subject: string;
  from?: {
    emailAddress: { name?: string; address: string };
  };
  toRecipients?: Array<{
    emailAddress: { name?: string; address: string };
  }>;
  receivedDateTime: string;
  bodyPreview: string;
  body?: { contentType: string; content: string };
  isRead: boolean;
  hasAttachments: boolean;
  importance: string;
}

export interface MailFolder {
  id: string;
  displayName: string;
  totalItemCount: number;
  unreadItemCount: number;
}

export interface Attachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  contentBytes?: string; // base64
}

interface GraphListResponse<T> {
  value: T[];
  "@odata.nextLink"?: string;
  "@odata.count"?: number;
}

// ─── Mail Folders ───────────────────────────────────────────────────

/** List all mail folders. */
export async function listFolders(): Promise<MailFolder[]> {
  const data = await graphJson<GraphListResponse<MailFolder>>(
    "/me/mailFolders?$top=100"
  );
  return data.value;
}

/** Get a specific folder by name (case-insensitive). */
export async function getFolderByName(
  name: string
): Promise<MailFolder | null> {
  const folders = await listFolders();
  return (
    folders.find(
      (f) => f.displayName.toLowerCase() === name.toLowerCase()
    ) ?? null
  );
}

// ─── List / Search Messages ─────────────────────────────────────────

export interface ListMessagesOptions {
  folder?: string; // folder ID or well-known name (inbox, sentitems, drafts)
  top?: number;
  skip?: number;
  select?: string[];
  orderBy?: string;
  filter?: string;
  search?: string; // KQL search query
}

/** List messages with pagination and optional filtering. */
export async function listMessages(
  options: ListMessagesOptions = {}
): Promise<{ messages: MailMessage[]; nextLink?: string }> {
  const {
    folder = "inbox",
    top = 25,
    skip = 0,
    select = [
      "id",
      "subject",
      "from",
      "toRecipients",
      "receivedDateTime",
      "bodyPreview",
      "isRead",
      "hasAttachments",
      "importance",
    ],
    orderBy = "receivedDateTime desc",
    filter,
    search,
  } = options;

  const params = new URLSearchParams();
  params.set("$top", String(top));
  if (skip > 0) params.set("$skip", String(skip));
  params.set("$select", select.join(","));
  params.set("$orderby", orderBy);
  if (filter) params.set("$filter", filter);
  if (search) params.set("$search", `"${search}"`);

  const endpoint = `/me/mailFolders/${folder}/messages?${params.toString()}`;
  const data = await graphJson<GraphListResponse<MailMessage>>(endpoint);

  return {
    messages: data.value,
    nextLink: data["@odata.nextLink"],
  };
}

/** Search messages using KQL (Keyword Query Language). */
export async function searchMessages(
  query: string,
  options: { folder?: string; top?: number } = {}
): Promise<MailMessage[]> {
  const result = await listMessages({
    ...options,
    search: query,
  });
  return result.messages;
}

// ─── Get Single Message ─────────────────────────────────────────────

export interface GetMessageOptions {
  includeBody?: boolean;
  bodyType?: "text" | "html";
}

/** Get a single message by ID. */
export async function getMessage(
  messageId: string,
  options: GetMessageOptions = {}
): Promise<MailMessage> {
  const { includeBody = true, bodyType = "text" } = options;

  const select = [
    "id",
    "subject",
    "from",
    "toRecipients",
    "receivedDateTime",
    "bodyPreview",
    "isRead",
    "hasAttachments",
    "importance",
  ];
  if (includeBody) select.push("body");

  const params = new URLSearchParams();
  params.set("$select", select.join(","));

  const headers: Record<string, string> = {};
  if (bodyType === "text") {
    headers["Prefer"] = 'outlook.body-content-type="text"';
  }

  return graphJson<MailMessage>(
    `/me/messages/${messageId}?${params.toString()}`,
    { headers }
  );
}

/** Get attachments for a message. */
export async function getAttachments(
  messageId: string
): Promise<Attachment[]> {
  const data = await graphJson<GraphListResponse<Attachment>>(
    `/me/messages/${messageId}/attachments`
  );
  return data.value;
}

// ─── Send Mail ──────────────────────────────────────────────────────

export interface SendMailOptions {
  to: string[];
  subject: string;
  body: string;
  bodyType?: "text" | "html";
  cc?: string[];
  bcc?: string[];
  saveToSentItems?: boolean;
}

/** Send an email. */
export async function sendMail(options: SendMailOptions): Promise<void> {
  const {
    to,
    subject,
    body,
    bodyType = "text",
    cc = [],
    bcc = [],
    saveToSentItems = true,
  } = options;

  const toRecipients = to.map((addr) => ({
    emailAddress: { address: addr },
  }));
  const ccRecipients = cc.map((addr) => ({
    emailAddress: { address: addr },
  }));
  const bccRecipients = bcc.map((addr) => ({
    emailAddress: { address: addr },
  }));

  await graphFetch("/me/sendMail", {
    method: "POST",
    body: {
      message: {
        subject,
        body: {
          contentType: bodyType === "html" ? "HTML" : "Text",
          content: body,
        },
        toRecipients,
        ccRecipients: ccRecipients.length > 0 ? ccRecipients : undefined,
        bccRecipients: bccRecipients.length > 0 ? bccRecipients : undefined,
      },
      saveToSentItems,
    },
  });
}

// ─── Export ──────────────────────────────────────────────────────────

/**
 * Export a message as raw MIME (.eml format).
 * Graph API supports $value on messages to get the MIME content.
 */
export async function exportAsEml(messageId: string): Promise<string> {
  const token = await getAccessToken();
  const response = await fetch(
    `${GRAPH_BASE}/me/messages/${messageId}/$value`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to export message ${messageId}: ${response.status}`
    );
  }
  return response.text();
}

/**
 * Bulk export messages to .eml files in a directory.
 * Returns the paths of exported files.
 */
export async function bulkExportEml(
  messageIds: string[],
  outputDir: string
): Promise<string[]> {
  fs.mkdirSync(outputDir, { recursive: true });
  const paths: string[] = [];

  for (const id of messageIds) {
    const eml = await exportAsEml(id);
    const filePath = path.join(outputDir, `${id}.eml`);
    fs.writeFileSync(filePath, eml);
    paths.push(filePath);
  }

  return paths;
}
