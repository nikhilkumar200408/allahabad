"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CurrentUser = void 0;
const common_1 = require("@nestjs/common");
exports.CurrentUser = (0, common_1.createParamDecorator)((property, ctx) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return property ? user?.[property] : user;
});
//# sourceMappingURL=current-user.decorator.js.map