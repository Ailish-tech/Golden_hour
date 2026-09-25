// ============================================================================
// SAMARITAN SHIELD — Detection Event Audit Trail
// ============================================================================

import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IDetectionEvent extends Document {
  cameraId: string;
  kind: 'ACCIDENT' | 'TRAFFIC_COUNT';
  stage1Score: number;
  stage2Score?: number;
  fusedConfidence: number;
  escalated: boolean;
  incidentId?: string;
  snapshotBase64?: string;
  detectedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DetectionEventSchema = new Schema<IDetectionEvent>(
  {
    cameraId: {
      type: String,
      required: [true, 'Camera ID is required'],
      index: true,
    },
    kind: {
      type: String,
      enum: {
        values: ['ACCIDENT', 'TRAFFIC_COUNT'],
        message: '{VALUE} is not a valid detection kind',
      },
      required: true,
    },
    stage1Score: {
      type: Number,
      required: true,
    },
    stage2Score: {
      type: Number,
    },
    fusedConfidence: {
      type: Number,
      required: true,
    },
    escalated: {
      type: Boolean,
      required: true,
      default: false,
    },
    incidentId: {
      type: String,
    },
    snapshotBase64: {
      type: String,
    },
    detectedAt: {
      type: Date,
      required: true,
      index: -1,
    },
  },
  {
    timestamps: true,
    collection: 'detection_events',
  }
);

const DetectionEvent: Model<IDetectionEvent> = mongoose.model<IDetectionEvent>('DetectionEvent', DetectionEventSchema);

export default DetectionEvent;
