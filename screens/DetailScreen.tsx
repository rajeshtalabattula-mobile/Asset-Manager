import React from 'react';
import RecordView from '../components/RecordView';
import SharePointService from '../services/sharepointService';

interface DetailScreenProps {
  sharePointService: SharePointService;
  listName: string;
  record: any;
  onBack: () => void;
  onRecordUpdated: () => void;
}

const DetailScreen: React.FC<DetailScreenProps> = ({
  sharePointService,
  listName,
  record,
  onBack,
  onRecordUpdated,
}) => {
  return (
    <RecordView
      sharePointService={sharePointService}
      listName={listName}
      record={record}
      onClose={onBack}
      onRecordUpdated={onRecordUpdated}
      onRecordDeleted={onRecordUpdated}
    />
  );
};

export default DetailScreen;
