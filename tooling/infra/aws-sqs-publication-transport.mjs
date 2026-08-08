import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";

const MAXIMUM_VISIBILITY_SECONDS = 43_200;

function boundedString(value, maximum) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function safeInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

export class AwsSqsPublicationQueueTransport {
  #client;
  #queueUrl;

  constructor({ accountId, region, queueName, queueUrl, client }) {
    if (!/^\d{12}$/.test(accountId ?? "")
      || region !== "us-west-2"
      || !/^[A-Za-z0-9_-]{1,80}$/.test(queueName ?? "")) {
      throw new TypeError("VFY_AWS_SQS_TRANSPORT_INVALID: queue identity is invalid");
    }
    const expectedQueueUrl = `https://sqs.${region}.amazonaws.com/${accountId}/${queueName}`;
    if (queueUrl !== expectedQueueUrl) {
      throw new TypeError("VFY_AWS_SQS_TRANSPORT_INVALID: queue URL is not exact");
    }
    this.#queueUrl = queueUrl;
    this.#client = client ?? new SQSClient({ region, maxAttempts: 3 });
  }

  async sendReferenceBody(body) {
    if (!boundedString(body, 2_048)) {
      throw new TypeError("VFY_AWS_SQS_TRANSPORT_INVALID: message body is invalid");
    }
    await this.#client.send(new SendMessageCommand({
      QueueUrl: this.#queueUrl,
      MessageBody: body,
    }));
  }

  async receiveOne({ waitTimeSeconds, visibilityTimeoutSeconds }) {
    if (!safeInteger(waitTimeSeconds, 0, 20)
      || !safeInteger(visibilityTimeoutSeconds, 1, MAXIMUM_VISIBILITY_SECONDS)) {
      throw new TypeError("VFY_AWS_SQS_TRANSPORT_INVALID: receive bounds are invalid");
    }
    const response = await this.#client.send(new ReceiveMessageCommand({
      QueueUrl: this.#queueUrl,
      AttributeNames: ["ApproximateReceiveCount"],
      MessageAttributeNames: [],
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: waitTimeSeconds,
      VisibilityTimeout: visibilityTimeoutSeconds,
    }));
    if ((response.Messages?.length ?? 0) === 0) return undefined;
    if (response.Messages.length !== 1) {
      throw new TypeError("VFY_AWS_SQS_TRANSPORT_INVALID: receive was not singular");
    }
    const [message] = response.Messages;
    const receiveCount = Number(message.Attributes?.ApproximateReceiveCount);
    if (!boundedString(message.MessageId, 256)
      || !boundedString(message.ReceiptHandle, 4_096)
      || !boundedString(message.Body, 2_048)
      || !safeInteger(receiveCount, 1, Number.MAX_SAFE_INTEGER)) {
      throw new TypeError("VFY_AWS_SQS_TRANSPORT_INVALID: received message is malformed");
    }
    return {
      messageId: message.MessageId,
      receiptHandle: message.ReceiptHandle,
      body: message.Body,
      receiveCount,
    };
  }

  async acknowledge(receiptHandle) {
    this.#assertReceiptHandle(receiptHandle);
    await this.#client.send(new DeleteMessageCommand({
      QueueUrl: this.#queueUrl,
      ReceiptHandle: receiptHandle,
    }));
  }

  async defer(receiptHandle, visibilityTimeoutSeconds) {
    this.#assertReceiptHandle(receiptHandle);
    if (!safeInteger(visibilityTimeoutSeconds, 1, MAXIMUM_VISIBILITY_SECONDS)) {
      throw new TypeError("VFY_AWS_SQS_TRANSPORT_INVALID: visibility bound is invalid");
    }
    await this.#client.send(new ChangeMessageVisibilityCommand({
      QueueUrl: this.#queueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: visibilityTimeoutSeconds,
    }));
  }

  #assertReceiptHandle(receiptHandle) {
    if (!boundedString(receiptHandle, 4_096)) {
      throw new TypeError("VFY_AWS_SQS_TRANSPORT_INVALID: receipt handle is invalid");
    }
  }
}
