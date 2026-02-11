import mongoose from 'mongoose';

const FormPermissionSchema = new mongoose.Schema({
  formId: {
    type: String,
    required: true
  },
  formTitle: String,
  permissions: {
    respond: {
      type: Boolean,
      default: false
    },
    viewResponses: {
      type: Boolean,
      default: false
    },
    edit: {
      type: Boolean,
      default: false
    },
    addFollowUp: {
      type: Boolean,
      default: false
    },
    delete: {
      type: Boolean,
      default: false
    },
    publicVisibility: {
      type: Boolean,
      default: false
    }
  }
}, { _id: false });

const RoleSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true,
    unique: true
  },
  description: String,
  permissions: [{
    type: String,
    enum: [
      'create_forms',
      'edit_forms',
      'delete_forms',
      'view_all_responses',
      'manage_users',
      'manage_roles',
      'view_analytics',
      'export_data',
      'system_settings',
      'upload:create',
      'upload:delete'
    ]
  }],
  formPermissions: [FormPermissionSchema],
  canCreateForms: {
    type: Boolean,
    default: false
  },
  isSystem: {
    type: Boolean,
    default: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Index for efficient queries
RoleSchema.index({ isSystem: 1 });

const Role = mongoose.model('Role', RoleSchema);

export default Role;