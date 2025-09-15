export enum ClickError {
    SUCCESS = 0,
    SIGN_CHECK_FAILED = -1,
    INVALID_AMOUNT = -2,
    ACTION_NOT_FOUND = -3,
    ALREADY_PAID = -4,
    USER_NOT_FOUND = -5,
    TRANSACTION_NOT_FOUND = -6,
    UPDATE_FAILED = -7,
    TRANSACTION_CANCELLED = -9,
}

export enum ClickErrorNote {
    SUCCESS = 'Success',
    SIGN_CHECK_FAILED = 'SIGN CHECK FAILED!',
    INVALID_AMOUNT = 'Incorrect parameter amount',
    ACTION_NOT_FOUND = 'Action not found',
    ALREADY_PAID = 'Already paid',
    USER_NOT_FOUND = 'User does not exist',
    TRANSACTION_NOT_FOUND = 'Transaction does not exist',
    UPDATE_FAILED = 'Failed to update user',
    TRANSACTION_CANCELLED = 'Transaction cancelled',
}
