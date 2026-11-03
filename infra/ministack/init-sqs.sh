#!/bin/sh
set -e

ENDPOINT_URL="${SQS_ENDPOINT:-http://ministack:4566}"
REGION="${AWS_REGION:-us-east-1}"
DLQ_NAME="${SQS_WAGER_TRANSACTIONS_DLQ_NAME:-wager-transactions-dlq.fifo}"
MAIN_QUEUE_NAME="${SQS_WAGER_TRANSACTIONS_QUEUE_NAME:-wager-transactions.fifo}"

echo "Waiting for MiniStack SQS at ${ENDPOINT_URL}..."
until aws --endpoint-url="${ENDPOINT_URL}" --region "${REGION}" sqs list-queues >/dev/null 2>&1; do
  sleep 1
done

echo "Creating DLQ: ${DLQ_NAME}"
DLQ_URL=$(aws --endpoint-url="${ENDPOINT_URL}" --region "${REGION}" sqs create-queue \
  --queue-name "${DLQ_NAME}" \
  --attributes FifoQueue=true,ContentBasedDeduplication=false \
  --query 'QueueUrl' \
  --output text)

DLQ_ARN=$(aws --endpoint-url="${ENDPOINT_URL}" --region "${REGION}" sqs get-queue-attributes \
  --queue-url "${DLQ_URL}" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)

echo "Creating main FIFO queue: ${MAIN_QUEUE_NAME} with RedrivePolicy -> ${DLQ_ARN}"
REDRIVE_POLICY="{\"deadLetterTargetArn\":\"${DLQ_ARN}\",\"maxReceiveCount\":\"5\"}"

CREATE_ATTRIBUTES=$(printf '{"FifoQueue":"true","ContentBasedDeduplication":"false","VisibilityTimeout":"30","RedrivePolicy":%s}' "$(printf '%s' "${REDRIVE_POLICY}" | sed 's/"/\\"/g' | awk '{print "\"" $0 "\""}')")

aws --endpoint-url="${ENDPOINT_URL}" --region "${REGION}" sqs create-queue \
  --queue-name "${MAIN_QUEUE_NAME}" \
  --attributes "${CREATE_ATTRIBUTES}" >/dev/null

echo "SQS FIFO queues successfully provisioned:"
aws --endpoint-url="${ENDPOINT_URL}" --region "${REGION}" sqs list-queues

