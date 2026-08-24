// ============================================================================
// SAMARITAN SHIELD — Hospital Staff Allowlist
// Out-of-band provisioning for the `hospital` role.
//
// A client cannot grant itself access to the live incident feed: role is
// derived from this collection, which is seeded by an administrator
// (see scripts/seed-hospital-staff.ts), never from a request body.
// ============================================================================

import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IHospitalStaff extends Document {
  email: string;
  hospitalId: string;
  hospitalName: string;
  invitedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const HospitalStaffSchema = new Schema<IHospitalStaff>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },

    hospitalId: {
      type: String,
      required: [true, 'Hospital ID is required'],
      trim: true,
      index: true,
    },

    hospitalName: {
      type: String,
      required: [true, 'Hospital name is required'],
      trim: true,
    },

    invitedBy: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: 'hospital_staff',
  }
);

const HospitalStaff: Model<IHospitalStaff> = mongoose.model<IHospitalStaff>(
  'HospitalStaff',
  HospitalStaffSchema
);

export default HospitalStaff;
