// ============================================================================
// SAMARITAN SHIELD — Control Room Staff Allowlist
// Out-of-band provisioning for the `control_room` role.
// ============================================================================

import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IControlRoomStaff extends Document {
  email: string;
  zone: string;
  invitedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ControlRoomStaffSchema = new Schema<IControlRoomStaff>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    zone: {
      type: String,
      required: [true, 'Zone is required'],
      trim: true,
    },
    invitedBy: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: 'control_room_staff',
  }
);

const ControlRoomStaff: Model<IControlRoomStaff> = mongoose.model<IControlRoomStaff>(
  'ControlRoomStaff',
  ControlRoomStaffSchema
);

export default ControlRoomStaff;
