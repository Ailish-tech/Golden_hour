// ============================================================================
// SAMARITAN SHIELD — User Model (MongoDB)
// Stores every authenticated user (citizen + hospital) with role & location
// ============================================================================

import mongoose, { Schema, Document, Model } from 'mongoose';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type UserRole = 'citizen' | 'hospital' | 'control_room';

export interface IUser extends Document {
  firebaseUid: string;
  email: string;
  displayName: string;
  role: UserRole;
  hospitalId?: string;
  hospitalName?: string;
  zone?: string;
  lastKnownLat?: number;
  lastKnownLng?: number;
  lastLocation?: {
    type: 'Point';
    coordinates: [number, number];
  };
  lastLoginAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const UserSchema = new Schema<IUser>(
  {
    firebaseUid: {
      type: String,
      required: [true, 'Firebase UID is required'],
      unique: true,
      trim: true,
      index: true,
    },

    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      index: true,
    },

    displayName: {
      type: String,
      required: true,
      trim: true,
      default: 'Samaritan User',
    },

    role: {
      type: String,
      enum: {
        values: ['citizen', 'hospital', 'control_room'],
        message: '{VALUE} is not a valid role',
      },
      required: true,
      default: 'citizen',
      index: true,
    },

    hospitalId: {
      type: String,
      trim: true,
    },

    hospitalName: {
      type: String,
      trim: true,
    },

    zone: {
      type: String,
      trim: true,
    },

    lastKnownLat: {
      type: Number,
    },

    lastKnownLng: {
      type: Number,
    },

    lastLocation: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number],
        default: undefined,
      },
    },

    lastLoginAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'users',
  }
);

// ---------------------------------------------------------------------------
// Compound indexes
// ---------------------------------------------------------------------------
UserSchema.index({ role: 1, lastLoginAt: -1 });
UserSchema.index({ lastLocation: '2dsphere' }, { sparse: true });

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
const User: Model<IUser> = mongoose.model<IUser>('User', UserSchema);

export default User;
