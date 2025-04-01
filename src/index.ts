#!/usr/bin/env node

/**
 * Firebase MCP Server
 * 
 * This server implements the Model Context Protocol (MCP) for Firebase services.
 * It provides tools for interacting with Firebase Authentication, Firestore, and Storage
 * through a standardized interface that can be used by AI assistants and other MCP clients.
 * 
 * @module firebase-mcp
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import * as admin from 'firebase-admin';

// Initialize Firebase
function initializeFirebase() {
  try {
    const serviceAccountPath = process.env.SERVICE_ACCOUNT_KEY_PATH;
    if (!serviceAccountPath) {
      return null;
    }

    try {
      const existingApp = admin.app();
      if (existingApp) {
        return existingApp;
      }
    } catch (error) {
      // No existing app, continue with initialization
    }

    const serviceAccount = require(serviceAccountPath);
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    return null;
  }
}

// Initialize Firebase
const app = initializeFirebase();

interface McpResponse {
  content: Array<{ type: string, text: string }>;
  isError?: boolean;
}

/**
 * Main server class that implements the MCP protocol for Firebase services.
 * Handles tool registration, request routing, and server lifecycle.
 */
class FirebaseMcpServer {
  /** The MCP server instance */
  private server: Server;

  /**
   * Initializes the Firebase MCP server with configuration and event handlers.
   */
  constructor() {
    this.server = new Server(
      {
        name: 'firebase-mcp',
        version: '0.1.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    this.setupToolHandlers();

    // Set up error handling and graceful shutdown
    this.server.onerror = () => {};
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  /**
   * Registers all available Firebase tools with the MCP server.
   * This includes tools for Firestore, Authentication, and Storage operations.
   * @private
   */
  private setupToolHandlers() {
    // Register available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'firestore_add_document',
          description: 'Add a document to a Firestore collection',
          inputSchema: {
            type: 'object',
            properties: {
              collection: {
                type: 'string',
                description: 'Collection name'
              },
              data: {
                type: 'object',
                description: 'Document data'
              }
            },
            required: ['collection', 'data']
          }
        },
        {
          name: 'firestore_list_documents',
          description: 'List documents from a Firestore collection with filtering and ordering',
          inputSchema: {
            type: 'object',
            properties: {
              collection: {
                type: 'string',
                description: 'Collection name'
              },
              filters: {
                type: 'array',
                description: 'Array of filter conditions',
                items: {
                  type: 'object',
                  properties: {
                    field: {
                      type: 'string',
                      description: 'Field name to filter'
                    },
                    operator: {
                      type: 'string',
                      description: 'Comparison operator (==, >, <, >=, <=, array-contains, in, array-contains-any)'
                    },
                    value: {
                      description: 'Value to compare against (use ISO format for dates)'
                    }
                  },
                  required: ['field', 'operator', 'value']
                }
              },
              limit: {
                type: 'number',
                description: 'Number of documents to return',
                default: 20
              },
              pageToken: {
                type: 'string',
                description: 'Token for pagination to get the next page of results'
              },
              orderBy: {
                type: 'array',
                description: 'Array of fields to order by',
                items: {
                  type: 'object',
                  properties: {
                    field: {
                      type: 'string',
                      description: 'Field name to order by'
                    },
                    direction: {
                      type: 'string',
                      description: 'Sort direction (asc or desc)',
                      enum: ['asc', 'desc'],
                      default: 'asc'
                    }
                  },
                  required: ['field']
                }
              }
            },
            required: ['collection']
          }
        },
        {
          name: 'firestore_list_collections',
          description: 'List root collections in Firestore',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      ]
    }));

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args = {} } = request.params;

      try {
        if (!app) {
          return {
            content: [{
              type: 'text',
              text: 'Firebase initialization failed'
            }]
          };
        }

        switch (name) {
          case 'firestore_add_document': {
            const collection = args.collection as string;
            const data = args.data as Record<string, any>;
            const docRef = await admin.firestore().collection(collection).add(data);
            
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  id: docRef.id,
                  path: docRef.path
                })
              }]
            };
          }

          case 'firestore_list_documents': {
            const collection = args.collection as string;
            const limit = Math.min(Math.max(1, (args.limit as number) || 20), 100); // Default 20, max 100
            
            let query: admin.firestore.Query = admin.firestore().collection(collection);

            // Apply filters if provided
            const filters = args.filters as Array<{
              field: string;
              operator: admin.firestore.WhereFilterOp;
              value: any;
            }> | undefined;

            if (filters && filters.length > 0) {
              filters.forEach(filter => {
                query = query.where(filter.field, filter.operator, filter.value);
              });
            }

            // Apply ordering if provided
            const orderBy = args.orderBy as Array<{
              field: string;
              direction?: 'asc' | 'desc';
            }> | undefined;

            if (orderBy && orderBy.length > 0) {
              orderBy.forEach(order => {
                query = query.orderBy(order.field, order.direction || 'asc');
              });
            }

            // Apply pagination if pageToken is provided
            const pageToken = args.pageToken as string | undefined;
            if (pageToken) {
              const lastDoc = await admin.firestore().doc(pageToken).get();
              if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
              }
            }
            
            // Apply limit
            query = query.limit(limit);
            
            const snapshot = await query.get();
            const documents = snapshot.docs.map(doc => {
              const rawData = doc.data();
              // Sanitize data to ensure it's JSON-serializable
              const data = Object.entries(rawData).reduce((acc, [key, value]) => {
                // Handle basic types directly
                if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
                  acc[key] = value;
                }
                // Convert Date objects to ISO strings
                else if (value instanceof Date) {
                  acc[key] = value.toISOString();
                }
                // Convert arrays to strings
                else if (Array.isArray(value)) {
                  acc[key] = `[${value.join(', ')}]`;
                }
                // Convert other objects to string representation
                else if (typeof value === 'object') {
                  acc[key] = '[Object]';
                }
                // Convert other types to strings
                else {
                  acc[key] = String(value);
                }
                return acc;
              }, {} as Record<string, any>);

              return {
                id: doc.id,
                path: doc.ref.path,
                data
              };
            });

            // Get the last document for pagination
            const lastVisible = snapshot.docs[snapshot.docs.length - 1];
            const nextPageToken = lastVisible ? lastVisible.ref.path : null;
            
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  documents,
                  nextPageToken
                })
              }]
            };
          }

          case 'firestore_list_collections':
            const collections = await admin.firestore().listCollections();
            const collectionList = collections.map(collection => ({
              id: collection.id,
              path: collection.path
            }));
            
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ collections: collectionList })
              }]
            };

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        // Check if it's an index error and extract the index creation URL
        if (errorMessage.includes('FAILED_PRECONDITION') && errorMessage.includes('requires an index')) {
          const indexUrl = errorMessage.match(/https:\/\/console\.firebase\.google\.com[^\s]*/)?.[0];
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'This query requires a composite index.',
                details: 'When ordering by multiple fields or combining filters with ordering, you need to create a composite index.',
                indexUrl: indexUrl || null
              })
            }]
          };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: errorMessage
            })
          }]
        };
      }
    });
  }

  /**
   * Starts the MCP server using stdio transport.
   * This method connects the server to stdin/stdout for communication with MCP clients.
   */
  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

// Create and start the server
const server = new FirebaseMcpServer();
server.run();
