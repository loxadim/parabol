import {commitLocalUpdate, commitMutation} from 'react-relay'
import graphql from 'babel-plugin-relay/macro'
import {Disposable, RecordProxy, RecordSourceSelectorProxy} from 'relay-runtime'
import getInProxy from '../utils/relay/getInProxy'
import handleAddReflectionToGroup from './handlers/handleAddReflectionToGroup'
import safeRemoveNodeFromArray from '../utils/relay/safeRemoveNodeFromArray'
import handleRemoveEmptyReflectionGroup from './handlers/handleRemoveEmptyReflectionGroup'
import createProxyRecord from '../utils/relay/createProxyRecord'
import updateProxyRecord from '../utils/relay/updateProxyRecord'
import dndNoise from '../utils/dndNoise'
import addNodeToArray from '../utils/relay/addNodeToArray'
import {LocalHandlers} from '../types/relayMutations'
import {IEndDraggingReflectionOnMutationArguments} from '../types/graphql'
import Atmosphere from '../Atmosphere'
import clientTempId from '../utils/relay/clientTempId'

graphql`
  fragment EndDraggingReflectionMutation_team on EndDraggingReflectionPayload {
    dragId
    meeting {
      id
      nextAutoGroupThreshold
      teamId
    }
    reflection {
      ...CompleteReflectionFrag @relay(mask: false)
    }

    reflectionGroup {
      id
      meetingId
      sortOrder
      retroPhaseItemId
      reflections {
        ...CompleteReflectionFrag @relay(mask: false)
      }
      title
      tasks {
        id
      }
    }
    oldReflectionGroup {
      id
      title
    }
    dropTargetType
    dropTargetId
    userId
  }
`

const mutation = graphql`
  mutation EndDraggingReflectionMutation(
    $reflectionId: ID!
    $dropTargetType: DragReflectionDropTargetTypeEnum
    $dropTargetId: ID
    $dragId: ID
  ) {
    endDraggingReflection(
      reflectionId: $reflectionId
      dropTargetType: $dropTargetType
      dropTargetId: $dropTargetId
      dragId: $dragId
    ) {
      ...EndDraggingReflectionMutation_team @relay(mask: false)
    }
  }
`

const handleRemoveReflectionFromGroup = (reflectionId: string, reflectionGroupId: string, store) => {
  const reflectionGroup = store.get(reflectionGroupId)
  if (!reflectionGroup) return
  safeRemoveNodeFromArray(reflectionId, reflectionGroup, 'reflections')
}

const handleAddReflectionGroupToGroups = (store, reflectionGroup) => {
  if (!reflectionGroup) return
  const meetingId = reflectionGroup.getValue('meetingId')
  const meeting = store.get(meetingId)
  if (!meeting) return
  addNodeToArray(reflectionGroup, meeting, 'reflectionGroups', 'sortOrder')
}

export const moveReflectionLocation = (
  reflection: RecordProxy,
  reflectionGroup: RecordProxy,
  oldReflectionGroupId: string,
  store: RecordSourceSelectorProxy,
) => {
  if (!reflection) return
  const reflectionId = reflection.getValue('id')
  // if (userId) {
  //   // else it is an autogroup
  //   const reflection = store.get(reflectionId)
  //   const meetingId = reflection.getValue('meetingId')
  //   const meeting = store.get(meetingId)
  //   // meeting.setValue(undefined, 'isViewerDragInProgress')
  //   // const dragContext = reflection.getLinkedRecord('dragContext')
  //   const dragUserId = reflection.getValue('dragUserId')
  //   const isViewerDragging = reflection.getValue('isViewerDragging')
  // }
  handleRemoveReflectionFromGroup(reflectionId, oldReflectionGroupId, store)
  handleAddReflectionToGroup(reflection, store)
  handleRemoveEmptyReflectionGroup(oldReflectionGroupId, store)
  handleAddReflectionGroupToGroups(store, reflectionGroup)
}

export const endDraggingReflectionTeamUpdater = (payload, {store}) => {
  const reflection = payload.getLinkedRecord('reflection')
  if (!reflection) return
  const reflectionGroup = payload.getLinkedRecord('reflectionGroup')
  const oldReflectionGroupId = getInProxy(payload, 'oldReflectionGroup', 'id')
  moveReflectionLocation(reflection, reflectionGroup, oldReflectionGroupId, store)
}

export const endDraggingReflectionTeamOnNext = (payload, context) => {
  const {atmosphere} = context
  const {reflection} = payload
  if (!reflection) return
  const {id: reflectionId} = reflection
  // commit a local update because it's guaranteed to only run once
  commitLocalUpdate(atmosphere, (store) => {
    const reflectionProxy = store.get(reflectionId)
    if (!reflectionProxy) return
    reflectionProxy.setValue(true, 'isDropping')
  })
}

const EndDraggingReflectionMutation = (
  atmosphere: Atmosphere,
  variables: IEndDraggingReflectionOnMutationArguments,
  {onError, onCompleted}: LocalHandlers = {}
): Disposable => {
  return commitMutation(atmosphere, {
    mutation,
    variables,
    onCompleted,
    onError,
    updater: (store) => {
      const payload = store.getRootField('endDraggingReflection')
      if (!payload) return
      const reflection = payload.getLinkedRecord('reflection')
      if (!reflection) return
      reflection.setValue(false, 'isViewerDragging')
      endDraggingReflectionTeamUpdater(payload, {store})
    },
    optimisticUpdater: (store) => {
      const nowISO = new Date().toJSON()
      const {reflectionId, dropTargetId: reflectionGroupId, dropTargetType} = variables
      const reflection = store.get(reflectionId)
      if (!reflection) return

      if (!dropTargetType) {
        reflection.setValue(false, 'isViewerDragging')
        return
      }

      const oldReflectionGroupId = reflection.getValue('reflectionGroupId')
      let reflectionGroupProxy
      const newReflectionGroupId = clientTempId()
      // move a reflection into its own group
      if (!reflectionGroupId) {
        // create the new group
        const reflectionGroup = {
          id: newReflectionGroupId,
          createdAt: nowISO,
          meetingId: reflection.getValue('meetingId'),
          isActive: true,
          sortOrder: 0,
          updatedAt: nowISO,
          voterIds: []
        }
        reflectionGroupProxy = createProxyRecord(store, 'RetroReflectionGroup', reflectionGroup)
        updateProxyRecord(reflection, {sortOrder: 0, reflectionGroupId: newReflectionGroupId})
      } else {
        reflectionGroupProxy = store.get(reflectionGroupId)
        const reflections = reflectionGroupProxy.getLinkedRecords('reflections')
        const maxSortOrder = Math.max(
          ...reflections.map((reflection) => (reflection ? reflection.getValue('sortOrder') : -1))
        )
        // move a card into another group
        updateProxyRecord(reflection, {
          sortOrder: maxSortOrder + 1 + dndNoise(),
          reflectionGroupId
        })
        reflection.setLinkedRecord(reflectionGroupProxy, 'retroReflectionGroup')
      }
      moveReflectionLocation(
        reflection,
        reflectionGroupProxy,
        oldReflectionGroupId,
        store,
      )
    }
  })
}

export default EndDraggingReflectionMutation
