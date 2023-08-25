// fetchClients.test.mjs

import { fetchClients } from "../src/program.js";
import { jest } from "@jest/globals";

test("fetchClients retrieves all clients", async () => {
  // Mock the directoryClient.requestResource function
  const mockRequestResource = jest.fn();

  mockRequestResource
    .mockResolvedValueOnce({
      body: JSON.stringify({
        content: [{ id: 1 }, { id: 2 }],
        totalPages: 2,
        totalSize: 4,
      }),
    })
    .mockResolvedValueOnce({
      body: JSON.stringify({
        content: [{ id: 3 }, { id: 4 }],
        totalPages: 2,
        totalSize: 4,
      }),
    });

  const mockDirectoryClient = {
    requestResource: mockRequestResource,
  };

  const clients = await fetchClients(mockDirectoryClient, "mockAccessToken");

  expect(clients).toHaveLength(4);
  expect(clients).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
});

test("fetchClients retrieves all clients across multiple pages", async () => {
  const mockRequestResource = jest.fn();

  mockRequestResource
    .mockResolvedValueOnce({
      body: JSON.stringify({
        content: [{ id: 1 }, { id: 2 }],
        totalPages: 2,
        totalSize: 4,
      }),
    })
    .mockResolvedValueOnce({
      body: JSON.stringify({
        content: [{ id: 3 }, { id: 4 }],
        totalPages: 2,
        totalSize: 4,
      }),
    });

  const mockDirectoryClient = {
    requestResource: mockRequestResource,
  };

  const clients = await fetchClients(mockDirectoryClient, "mockAccessToken");

  expect(clients).toHaveLength(4);
  expect(clients).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
});

test("fetchClients handles empty directory", async () => {
  const mockRequestResource = jest.fn().mockResolvedValueOnce({
    body: JSON.stringify({
      content: [],
      totalPages: 1,
      totalSize: 0,
    }),
  });

  const mockDirectoryClient = {
    requestResource: mockRequestResource,
  };

  const clients = await fetchClients(mockDirectoryClient, "mockAccessToken");

  expect(clients).toHaveLength(0);
});
