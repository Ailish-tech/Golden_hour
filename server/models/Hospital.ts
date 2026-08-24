// ============================================================================
// SAMARITAN SHIELD — Hospital Capacity
//
// Live capacity as reported by a hospital desk. Absence of a record means
// capacity is unknown, which is reported as unknown — routing a responder on
// an invented bed count is worse than telling them we do not know.
// ============================================================================

import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IHospital extends Document {
  hospitalId: string;
  name: string;
  icuBedsAvailable: number;
  reportedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const HospitalSchema = new Schema<IHospital>(
  {
    hospitalId: {
      type: String,
      required: [true, 'Hospital ID is required'],
      unique: true,
      trim: true,
      index: true,
    },

    name: {
      type: String,
      required: [true, 'Hospital name is required'],
      trim: true,
    },

    icuBedsAvailable: {
      type: Number,
      required: true,
      min: [0, 'Bed count cannot be negative'],
      default: 0,
    },

    reportedBy: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: 'hospitals',
  }
);

const Hospital: Model<IHospital> = mongoose.model<IHospital>('Hospital', HospitalSchema);

export default Hospital;
