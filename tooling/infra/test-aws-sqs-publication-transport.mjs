#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";
import { AwsSqsPublicationQueueTransport } from "./aws-sqs-publication-transport.mjs";

const identity = {
  accountId: "123456789012",
  region: "us-west-2",
  queueName: "verification-development-metadata",
  queueUrl: "https://sqs.us-west-2.amazonaws.com/123456789012/verification-development-metadata",
};

class FakeClient {
  commands = [];
  responses = [];

  async send(command) {
    this.commands.push(command);
    return this.responses.shift() ?? {};
  }
}

test("transport binds the exact account, region, name, and HTTPS queue URL", () => {
  assert.doesNotThrow(() => new AwsSqsPublicationQueueTransport({ ...identity, client: new FakeClient() }));
  assert.throws(
    () => new AwsSqsPublicationQueueTransport({
      ...identity,
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/verification-development-metadata",
      client: new FakeClient(),
    }),
    /queue URL is not exact/,
  );
  assert.throws(
    () => new AwsSqsPublicationQueueTransport({ ...identity, accountId: "123", client: new FakeClient() }),
    /queue identity is invalid/,
  );
});

test("transport sends, receives, acknowledges, and defers only one bounded message", async () => {
  const client = new FakeClient();
  client.responses.push(
    {},
    {
      Messages: [{
        MessageId: "message:one",
        ReceiptHandle: "receipt:one",
        Body: "{\"kind\":\"reference\"}",
        Attributes: { ApproximateReceiveCount: "2" },
      }],
    },
    {},
    {},
  );
  const transport = new AwsSqsPublicationQueueTransport({ ...identity, client });
  await transport.sendReferenceBody("{\"kind\":\"reference\"}");
  assert.ok(client.commands[0] instanceof SendMessageCommand);
  assert.deepEqual(await transport.receiveOne({ waitTimeSeconds: 20, visibilityTimeoutSeconds: 60 }), {
    messageId: "message:one",
    receiptHandle: "receipt:one",
    body: "{\"kind\":\"reference\"}",
    receiveCount: 2,
  });
  assert.ok(client.commands[1] instanceof ReceiveMessageCommand);
  assert.equal(client.commands[1].input.MaxNumberOfMessages, 1);
  assert.deepEqual(client.commands[1].input.MessageAttributeNames, []);
  await transport.acknowledge("receipt:one");
  assert.ok(client.commands[2] instanceof DeleteMessageCommand);
  await transport.defer("receipt:two", 30);
  assert.ok(client.commands[3] instanceof ChangeMessageVisibilityCommand);
  assert.equal(client.commands[3].input.VisibilityTimeout, 30);
});

test("transport fails closed on malformed messages and out-of-range operations", async () => {
  const client = new FakeClient();
  client.responses.push({
    Messages: [{
      MessageId: "message:one",
      ReceiptHandle: "receipt:one",
      Body: "{}",
      Attributes: { ApproximateReceiveCount: "not-a-number" },
    }],
  });
  const transport = new AwsSqsPublicationQueueTransport({ ...identity, client });
  await assert.rejects(
    transport.receiveOne({ waitTimeSeconds: 20, visibilityTimeoutSeconds: 60 }),
    /received message is malformed/,
  );
  await assert.rejects(
    transport.receiveOne({ waitTimeSeconds: 21, visibilityTimeoutSeconds: 60 }),
    /receive bounds are invalid/,
  );
  await assert.rejects(transport.sendReferenceBody(""), /message body is invalid/);
  await assert.rejects(transport.defer("receipt", 0), /visibility bound is invalid/);
});
