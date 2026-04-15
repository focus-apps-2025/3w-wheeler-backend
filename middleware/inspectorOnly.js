/**
 * Middleware to restrict access to inspector role only
 */
export const inspectorOnly = (req, res, next) => {
  console.log('inspectorOnly - user role:', req.user?.role, 'user:', req.user?.firstName, req.user?.lastName);
  if (req.user && req.user.role === 'inspector') {
    return next();
  }
  
  return res.status(403).json({
    success: false,
    message: 'Access denied. Inspector role required.'
  });
};
