import { Controller, ForbiddenException, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ChildrenService } from '../children/children.service';

@ApiTags('parents')
@ApiBearerAuth()
@Controller('parents/me')
export class ParentsController {
  constructor(private readonly childrenService: ChildrenService) {}

  @Get('children')
  children(@CurrentUser() user: AuthenticatedUser) {
    if (!user.parentId) {
      throw new ForbiddenException('This account is not a parent account.');
    }
    return this.childrenService.findAllForParent(user.parentId);
  }
}
