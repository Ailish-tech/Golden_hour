// ============================================================================
// SAMARITAN SHIELD — Incident Model (GeoJSON + Spatial Index)
// ============================================================================

import mongoose, { Schema, Document, Model } from 'mongoose';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type IncidentStatus = 'REPORTED' | 'AMBULANCE_DISPATCHED' | 'ICU_RESERVED' | 'RESOLVED';
export type VictimCondition = 'CRITICAL_UNCONSCIOUS' | 'CPR_ACTIVE' | 'AIRWAY_OBSTRUCTED' | 'RECOVERY_POSITION' | 'BLEEDING_TRAUMA' | 'BLEEDING_CONTROLLED';

/** A Good Samaritan's certificate record for an incident. */
export interface ICertificateRecord {
  reporterId: string;
  hash: string;
  issuedAt: Date;
}

export interface IIncident extends Document {
  location: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
  status: IncidentStatus;
  primaryReporterId: string;
  secondaryReporters: string[];
  victimCondition: VictimCondition;
  cprCompressions: number;
  cprSets: number;
  ambulanceUnitAssigned?: string;
  icuBedReserved?: boolean;
  assignedHospitalId?: string;
  assignedHospitalName?: string;
  phone?: string;
  /**
   * One record per responder. Each Good Samaritan who reports this incident
   * gets their own certificate, so the digest printed on a certificate can be
   * checked against what the server actually stored.
   */
  certificates: ICertificateRecord[];
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const IncidentSchema = new Schema<IIncident>(
  {
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

    status: {
      type: String,
      enum: {
        values: ['REPORTED', 'AMBULANCE_DISPATCHED', 'ICU_RESERVED', 'RESOLVED'],
        message: '{VALUE} is not a valid incident status',
      },
      default: 'REPORTED',
      required: true,
      index: true,
    },

    primaryReporterId: {
      type: String,
      required: [true, 'Primary reporter ID is required'],
      trim: true,
    },

    secondaryReporters: {
      type: [String],
      default: [],
    },

    victimCondition: {
      type: String,
      enum: ['CRITICAL_UNCONSCIOUS', 'CPR_ACTIVE', 'AIRWAY_OBSTRUCTED', 'RECOVERY_POSITION', 'BLEEDING_TRAUMA', 'BLEEDING_CONTROLLED'],
      default: 'CRITICAL_UNCONSCIOUS',
    },

    cprCompressions: {
      type: Number,
      default: 0,
    },

    cprSets: {
      type: Number,
      default: 1,
    },

    ambulanceUnitAssigned: {
      type: String,
      trim: true,
    },

    icuBedReserved: {
      type: Boolean,
      default: false,
    },

    assignedHospitalId: {
      type: String,
      trim: true,
    },

    assignedHospitalName: {
      type: String,
      trim: true,
    },

    phone: {
      type: String,
      default: '+91-98765-43210',
    },

    certificates: {
      type: [
        new Schema<ICertificateRecord>(
          {
            reporterId: { type: String, required: true, trim: true },
            hash: { type: String, required: true, trim: true, index: true },
            issuedAt: { type: Date, required: true, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'incidents',
  }
);

// ---------------------------------------------------------------------------
// 2dsphere Index — enables $near / $geoNear spatial queries
// ---------------------------------------------------------------------------
IncidentSchema.index({ location: '2dsphere' });

// Compound index for the dedup query (status + location)
IncidentSchema.index({ status: 1, location: '2dsphere' });

// Certificate lookup by digest, for GET /api/verify/:hash
IncidentSchema.index({ 'certificates.hash': 1 });

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
const Incident: Model<IIncident> = mongoose.model<IIncident>('Incident', IncidentSchema);

export default Incident;
