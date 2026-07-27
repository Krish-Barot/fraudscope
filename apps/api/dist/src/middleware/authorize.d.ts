import { Request, Response, NextFunction } from 'express';
export declare function authorize(...allowedRoles: ('analyst' | 'admin')[]): (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=authorize.d.ts.map