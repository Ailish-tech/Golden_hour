// ============================================================================
// SAMARITAN SHIELD — Traffic Signal State
// ============================================================================

import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ITrafficSignal extends Document {
  signalId: string;
  name: string;
  location: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
  approaches: string[];
  currentPhase: {
    approach: string;
    state: 'GREEN' | 'YELLOW' | 'RED';
    endsAt: Date;
  };
  adaptiveGreenSeconds: number;
  lastVehicleCounts: {
    N: number;
    S: number;
    E: number;
    W: number;
  };
  preemption?: {
    corridorId: string;
    approach: string;
    holdFrom: Date;
    holdUntil: Date;
  };
  mode: 'ADAPTIVE' | 'PREEMPTED' | 'MANUAL';
  createdAt: Date;
  updatedAt: Date;
}

const TrafficSignalSchema = new Schema<ITrafficSignal>(
  {
    signalId: {
      type: String,
      required: [true, 'Signal ID is required'],
      unique: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Signal name is required'],
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
    approaches: {
      type: [String],
      required: true,
      validate: {
        validator: (v: string[]) => Array.isArray(v) && v.length > 0,
        message: 'At least one approach is required',
      },
    },
    currentPhase: {
      approach: { type: String, required: true },
      state: { 
        type: String, 
        enum: ['GREEN', 'YELLOW', 'RED'],
        required: true 
      },
      endsAt: { type: Date, required: true },
    },
    adaptiveGreenSeconds: {
      type: Number,
      default: 30,
    },
    lastVehicleCounts: {
      N: { type: Number, default: 0 },
      S: { type: Number, default: 0 },
      E: { type: Number, default: 0 },
      W: { type: Number, default: 0 },
    },
    preemption: {
      corridorId: { type: String },
      approach: { type: String },
      holdFrom: { type: Date },
      holdUntil: { type: Date },
    },
    mode: {
      type: String,
      enum: {
        values: ['ADAPTIVE', 'PREEMPTED', 'MANUAL'],
        message: '{VALUE} is not a valid mode',
      },
      default: 'ADAPTIVE',
    },
  },
  {
    timestamps: true,
    collection: 'traffic_signals',
  }
);

TrafficSignalSchema.index({ location: '2dsphere' });

const TrafficSignal: Model<ITrafficSignal> = mongoose.model<ITrafficSignal>('TrafficSignal', TrafficSignalSchema);

export default TrafficSignal;
