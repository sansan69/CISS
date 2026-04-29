class TrainingAssignmentModel {
  const TrainingAssignmentModel({
    required this.id,
    required this.title,
    required this.status,
    required this.dueLabel,
  });

  final String id;
  final String title;
  final String status;
  final String dueLabel;
}

class EvaluationModel {
  const EvaluationModel({
    required this.id,
    required this.title,
    required this.status,
    required this.scoreLabel,
  });

  final String id;
  final String title;
  final String status;
  final String scoreLabel;
}

