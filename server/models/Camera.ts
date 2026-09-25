// ============================================================================
// SAMARITAN SHIELD — Camera Registry
// ============================================================================

import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ICamera extends Document {
  cameraId: string;
  name: string;
  zone: string;
  location: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
  source: string;
  approach?: string;
  signalId?: string;
  status: 'ONLINE' | 'OFFLINE' | 'DEGRADED';
  lastFrameAt?: Date;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CameraSchema = new Schema<ICamera>(
  {
    cameraId: {
      type: String,
      required: [true, 'Camera ID is required'],
      unique: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Camera name is required'],
      trim: true,
    },
    zone: {
      type: String,
      required: [true, 'Zone is required'],
      trim: true,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        required: [true, 'Location type is required and must be "Point"'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: [true, 'Coordinates [longitude, latitude] are required'],
        validate: {
          validator: (coords: number[]): boolean => {
            if (!Array.isArray(coords) || coords.length !== 2) return false;
            const [lng, lat] = coords;
            return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
          },
          message: 'Coordinates must be [longitude, latitude] with valid ranges',
        },
      },
    },
    source: {
      type: String,
      required: [true, 'Camera source is required'],
      trim: true,
    },
    approach: {
      type: String,
      trim: true,
    },
    signalId: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: {
        values: ['ONLINE', 'OFFLINE', 'DEGRADED'],
        message: '{VALUE} is not a valid status',
      },
      default: 'OFFLINE',
    },
    lastFrameAt: {
      type: Date,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: 'cameras',
  }
);

CameraSchema.index({ location: '2dsphere' });

const Camera: Model<ICamera> = mongoose.model<ICamera>('Camera', CameraSchema);

export default Camera;
