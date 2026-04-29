class VisitReportModel {
  const VisitReportModel({
    required this.id,
    required this.siteName,
    required this.dateLabel,
    required this.summary,
  });

  final String id;
  final String siteName;
  final String dateLabel;
  final String summary;
}

class TrainingReportModel {
  const TrainingReportModel({
    required this.id,
    required this.siteName,
    required this.dateLabel,
    required this.topic,
  });

  final String id;
  final String siteName;
  final String dateLabel;
  final String topic;
}

class WorkOrderModel {
  const WorkOrderModel({
    required this.id,
    required this.siteName,
    required this.examName,
    required this.dateLabel,
    required this.totalManpowerLabel,
  });

  final String id;
  final String siteName;
  final String examName;
  final String dateLabel;
  final String totalManpowerLabel;
}

