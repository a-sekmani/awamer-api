import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

const mockUsersService = {
  getMe: jest.fn(),
  updateUser: jest.fn(),
  updateProfile: jest.fn(),
  changePassword: jest.fn(),
  submitOnboarding: jest.fn(),
  getOnboardingStatus: jest.fn(),
};

const mockPrismaService = {
  user: {
    findUnique: jest.fn().mockResolvedValue({ emailVerified: true }),
  },
};

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
        { provide: PrismaService, useValue: mockPrismaService },
        Reflector,
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('GET /users/me delegates to getMe and wraps response', async () => {
    const mockData = {
      user: { id: 'uuid' },
      profile: {},
      role: 'learner',
      subscription: null,
    };
    mockUsersService.getMe.mockResolvedValue(mockData);

    const mockReq = { user: { userId: 'user-uuid' } } as any;
    const result = await controller.getMe(mockReq);

    expect(mockUsersService.getMe).toHaveBeenCalledWith('user-uuid');
    expect(result).toEqual({ data: mockData, message: 'Success' });
  });

  it('PATCH /users/me delegates to updateUser and wraps response', async () => {
    const mockUser = { id: 'uuid', name: 'Updated' };
    mockUsersService.updateUser.mockResolvedValue(mockUser);

    const mockReq = { user: { userId: 'user-uuid' } } as any;
    const dto = { name: 'Updated' };
    const result = await controller.updateUser(mockReq, dto);

    expect(mockUsersService.updateUser).toHaveBeenCalledWith(
      'user-uuid',
      dto,
    );
    expect(result).toEqual({ data: { user: mockUser }, message: 'Success' });
  });

  it('PATCH /users/me/profile delegates to updateProfile and wraps response', async () => {
    const mockProfileData = { displayName: 'Ahmad' };
    mockUsersService.updateProfile.mockResolvedValue(mockProfileData);

    const mockReq = { user: { userId: 'user-uuid' } } as any;
    const dto = { displayName: 'Ahmad' };
    const result = await controller.updateProfile(mockReq, dto);

    expect(mockUsersService.updateProfile).toHaveBeenCalledWith(
      'user-uuid',
      dto,
    );
    expect(result).toEqual({
      data: { profile: mockProfileData },
      message: 'Success',
    });
  });

  it('PATCH /users/me/password delegates to changePassword and returns message', async () => {
    mockUsersService.changePassword.mockResolvedValue(undefined);

    const mockReq = { user: { userId: 'user-uuid' } } as any;
    const dto = { currentPassword: 'old', newPassword: 'New1234' };
    const result = await controller.changePassword(mockReq, dto);

    expect(mockUsersService.changePassword).toHaveBeenCalledWith(
      'user-uuid',
      dto,
    );
    expect(result).toEqual({ data: null, message: 'Password updated' });
  });

  it('POST /users/me/onboarding delegates to submitOnboarding and wraps response', async () => {
    const mockProfileData = { onboardingCompleted: true };
    mockUsersService.submitOnboarding.mockResolvedValue(mockProfileData);

    const mockReq = { user: { userId: 'user-uuid' } } as any;
    const dto = {
      responses: [{ questionKey: 'q', answer: 'a', stepNumber: 1 }],
    };
    const result = await controller.submitOnboarding(mockReq, dto as any);

    expect(mockUsersService.submitOnboarding).toHaveBeenCalledWith(
      'user-uuid',
      dto,
    );
    expect(result).toEqual({
      data: { profile: mockProfileData },
      message: 'Success',
    });
  });

  it('GET /users/me/onboarding delegates to getOnboardingStatus and wraps response', async () => {
    const mockStatus = { completed: true, responses: [] };
    mockUsersService.getOnboardingStatus.mockResolvedValue(mockStatus);

    const mockReq = { user: { userId: 'user-uuid' } } as any;
    const result = await controller.getOnboardingStatus(mockReq);

    expect(mockUsersService.getOnboardingStatus).toHaveBeenCalledWith(
      'user-uuid',
    );
    expect(result).toEqual({ data: mockStatus, message: 'Success' });
  });
});
