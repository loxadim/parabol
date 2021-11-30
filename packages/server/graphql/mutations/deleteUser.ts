import {GraphQLID, GraphQLNonNull, GraphQLString} from 'graphql'
import {USER_REASON_REMOVED_LIMIT} from '../../postgres/constants'
import {getUserByEmail} from '../../postgres/queries/getUsersByEmails'
import {getUserById} from '../../postgres/queries/getUsersByIds'
import updateUser from '../../postgres/queries/updateUser'
import {getUserId, isSuperUser} from '../../utils/authorization'
import getDeletedEmail from '../../utils/getDeletedEmail'
import segmentIo from '../../utils/segmentIo'
import {GQLContext} from '../graphql'
import DeleteUserPayload from '../types/DeleteUserPayload'
import removeFromOrg from './helpers/removeFromOrg'
import removeSlackAuths from './helpers/removeSlackAuths'

export default {
  type: new GraphQLNonNull(DeleteUserPayload),
  description: `Delete a user, removing them from all teams and orgs`,
  args: {
    userId: {
      type: GraphQLID,
      description: 'a userId'
    },
    email: {
      type: GraphQLID,
      description: 'the user email'
    },
    reason: {
      type: GraphQLString,
      description: 'the reason why the user wants to delete their account'
    }
  },
  resolve: async (
    _source: unknown,
    {userId, email, reason},
    {authToken, dataLoader}: GQLContext
  ) => {
    // AUTH
    if (userId && email) {
      return {error: {message: 'Provide userId XOR email'}}
    }
    if (!userId && !email) {
      return {error: {message: 'Provide a userId or email'}}
    }
    const su = isSuperUser(authToken)
    const viewerId = getUserId(authToken)

    const user = userId ? await getUserById(userId) : email ? await getUserByEmail(email) : null
    if (!su) {
      if (!user || userId !== viewerId) {
        return {error: {message: 'Cannot delete someone else'}}
      }
    } else if (!user) {
      return {error: {message: 'User not found'}}
    }
    const {id: userIdToDelete, tms} = user
    removeSlackAuths(userIdToDelete, tms, true)
    const orgUsers = await dataLoader.get('organizationUsersByUserId').load(userIdToDelete)
    const orgIds = orgUsers.map((orgUser) => orgUser.orgId)
    await Promise.all(
      orgIds.map((orgId) => removeFromOrg(userIdToDelete, orgId, undefined, dataLoader))
    )
    const validReason = reason?.trim().slice(0, USER_REASON_REMOVED_LIMIT) || 'No reason provided'
    if (userId) {
      segmentIo.track({
        userId,
        event: 'Account Removed',
        properties: {
          reason: validReason
        }
      })
    }
    // do this after 30 seconds so any segment API calls can still get the email
    setTimeout(() => {
      updateUser(
        {
          isRemoved: true,
          email: getDeletedEmail(userId),
          reasonRemoved: validReason
        },
        userIdToDelete
      )
    }, 30000)
    return {}
  }
}
