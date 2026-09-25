// ============================================================================
// SAMARITAN SHIELD — Green Corridor Route
// ============================================================================

import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IGreenCorridor extends Document {
  incidentId: string;
  status: 'ACTIVE' | 'CLEARED' | 'EXPIRED';
  originHospitalId?: string;
  routeGeometry: {
    type: 'LineString';
    coordinates: [number, number][]; // Array of [longitude, latitude]
  };
  totalDistanceKm: number;
  baselineEtaMinutes: number;
  optimisedEtaMinutes: number;
  signals: {
    signalId: string;
    sequenceIndex: number;
    distanceAlongRouteKm: number;
    etaSeconds: number;
    approach: string;
    preemptedAt?: Date;
    clearedAt?: Date;
  }[];
  openedAt: Date;
  clearedAt?: Date;
  degraded?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const GreenCorridorSchema = new Schema<IGreenCorridor>(
  {
    incidentId: {
      type: String,
      required: [true, 'Incident ID is required'],
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: ['ACTIVE', 'CLEARED', 'EXPIRED'],
        message: '{VALUE} is not a valid status',
      },
      required: true,
    },
    originHospitalId: {
      type: String,
    },
    routeGeometry: {
      type: {
        type: String,
        enum: ['LineString'],
        required: [true, 'Route geometry type is required and must be "LineString"'],
        default: 'LineString',
      },
      coordinates: {
        type: [[Number]],
        required: [true, 'Coordinates array is required'],
      },
    },
    totalDistanceKm: {
      type: Number,
      required: true,
    },
    baselineEtaMinutes: {
      type: Number,
      required: true,
    },
    optimisedEtaMinutes: {
      type: Number,
      required: true,
    },
    signals: [
      {
        signalId: { type: String, required: true },
        sequenceIndex: { type: Number, required: true },
        distanceAlongRouteKm: { type: Number, required: true },
        etaSeconds: { type: Number, required: true },
        approach: { type: String, required: true },
        preemptedAt: { type: Date },
        clearedAt: { type: Date },
      },
    ],
    openedAt: {
      type: Date,
      required: true,
    },
    clearedAt: {
      type: Date,
    },
    degraded: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    collection: 'green_corridors',
  }
);

const GreenCorridor: Model<IGreenCorridor> = mongoose.model<IGreenCorridor>('GreenCorridor', GreenCorridorSchema);

export default GreenCorridor;
