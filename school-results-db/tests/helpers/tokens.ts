import { signToken } from '../../src/middleware/auth.js';

export const TEST_USERS = {
  admin: {
    userId: '00000000-0000-0000-0000-0000000000a1',
    role: 'admin' as const
  },
  principal: {
    userId: '00000000-0000-0000-0000-0000000000a1',
    role: 'principal' as const
  },
  examController: {
    userId: '00000000-0000-0000-0000-0000000000a1',
    role: 'exam_controller' as const
  },
  teacherMaths: {
    userId: '00000000-0000-0000-0000-0000000000b1',
    role: 'teacher' as const
  },
  teacherEnglish: {
    userId: '00000000-0000-0000-0000-0000000000b2',
    role: 'teacher' as const
  },
  parentAli: {
    userId: '00000000-0000-0000-0000-0000000000c1',
    role: 'parent' as const
  },
  studentSara: {
    userId: '00000000-0000-0000-0000-0000000000c2',
    role: 'student' as const
  }
};

export const getAuthToken = (userKey: keyof typeof TEST_USERS) => {
  const user = TEST_USERS[userKey];
  return signToken(user);
};

export const getAuthHeader = (userKey: keyof typeof TEST_USERS) => {
  return { authorization: `Bearer ${getAuthToken(userKey)}` };
};
